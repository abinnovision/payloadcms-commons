import { invalid } from "../options.js";

import type { StartupLogger } from "../options.js";
import type { FlueAgentConfig, FlueCollectionGrant } from "../types.js";
import type {
	Access,
	BaseFilter,
	CollectionConfig,
	Field,
	FieldAccess,
	GroupField,
	SelectType,
	Where,
} from "payload";

/** The field marking a key flue manages, holding `flue:<agent>`. */
export const MANAGED_BY = "managedBy";

const UNMANAGED: Where = { [MANAGED_BY]: { exists: false } };

/** The operations a grant may tick, each with the one it requires. */
export const GRANTS = ["read", "write", "publish", "delete"] as const;
const REQUIRES: Partial<
	Record<(typeof GRANTS)[number], (typeof GRANTS)[number]>
> = { write: "read", publish: "write", delete: "read" };

/** One collection or global on mcpx's keys: its group's field name and checkboxes. */
export interface CapabilityEntity {
	field: string;
	operations: string[];
}

/**
 * The checkboxes of mcpx's key collection, keyed by slug, as mcpx derived them
 * from its options.
 */
export interface CapabilityFieldMap {
	collections: Record<string, CapabilityEntity>;
	globals: Record<string, CapabilityEntity>;
	tools: string[];
}

type KeyCollection = Pick<CollectionConfig, "fields" | "slug">;

const isNamed = (field: Field, name: string): boolean =>
	"name" in field && field.name === name;

// Rows, collapsibles and unnamed groups keep their fields' data at their parent's level.
const isLayout = (field: Field): field is Extract<Field, { fields: Field[] }> =>
	field.type === "row" ||
	field.type === "collapsible" ||
	(field.type === "group" && !("name" in field && field.name));

/** The fields whose data sits at the document root. */
const rootFields = (fields: Field[]): Field[] =>
	fields.flatMap((field) => {
		if (field.type === "tabs") {
			return field.tabs.flatMap((tab) =>
				"name" in tab && tab.name ? [] : rootFields(tab.fields),
			);
		}

		return isLayout(field) ? rootFields(field.fields) : [field];
	});

const rootField = (
	collection: KeyCollection,
	name: string,
): Field | undefined =>
	rootFields(collection.fields).find((field) => isNamed(field, name));

const requireField = (collection: KeyCollection, name: string): Field => {
	const field = rootField(collection, name);

	if (!field) {
		throw invalid(
			`The mcpx API key collection "${collection.slug}" has no "${name}" field, which flue depends on.`,
		);
	}

	return field;
};

const requireGroup = (
	collection: KeyCollection,
	fields: Field[],
	path: string,
): GroupField => {
	const name = path.split(".").pop() ?? path;
	const field = fields.find((candidate) => isNamed(candidate, name));

	if (field?.type !== "group") {
		throw invalid(
			`The mcpx API key collection "${collection.slug}" has no "${path}" group, which flue depends on.`,
		);
	}

	return field;
};

/** Maps the fields whose data sits at the document root. */
const mapRootFields = (
	fields: Field[],
	map: (field: Field) => Field,
): Field[] =>
	fields.map((field) => {
		if (field.type === "tabs") {
			return {
				...field,
				tabs: field.tabs.map((tab) =>
					"name" in tab && tab.name
						? tab
						: { ...tab, fields: mapRootFields(tab.fields, map) },
				),
			};
		}

		if (isLayout(field)) {
			return { ...field, fields: mapRootFields(field.fields, map) };
		}

		return map(field);
	});

const isManaged = (value: unknown): boolean =>
	value !== null && value !== undefined;

/*
 * Refuses the plaintext of a managed key. A row without a marker value, from a
 * projection or an adapter that omits unset fields, is looked up; any failure
 * refuses.
 */
const lockApiKeyRead =
	(slug: string, read: FieldAccess | undefined): FieldAccess =>
	async (args) => {
		if (read && !(await read(args))) {
			return false;
		}

		const doc = args.doc as Record<string, unknown> | undefined;

		if (doc?.[MANAGED_BY] !== undefined) {
			return !isManaged(doc[MANAGED_BY]);
		}

		const id = args.id ?? doc?.["id"];

		if (typeof id !== "string" && typeof id !== "number") {
			return false;
		}

		try {
			const stored = (await args.req.payload.findByID({
				collection: slug,
				id,
				overrideAccess: true,
				disableErrors: true,
				select: { [MANAGED_BY]: true },
				req: args.req,
			})) as null | Record<string, unknown>;

			return stored !== null && !isManaged(stored[MANAGED_BY]);
		} catch {
			return false;
		}
	};

// Payload's rule: the first `false` leaf, depth first, makes a select exclude mode.
const isExcludeSelect = (select: SelectType): boolean => {
	for (const value of Object.values<boolean | SelectType>(select)) {
		if (value === false) {
			return true;
		}

		if (typeof value === "object") {
			return isExcludeSelect(value);
		}
	}

	return false;
};

type SelectFn = NonNullable<CollectionConfig["select"]>;

/*
 * Every read carries the marker, so the `apiKey` lock decides from the row. An
 * exclude select that names only the marker keeps it out instead: dropping it
 * would leave an empty select, which reads as include mode and selects
 * nothing, so the lock looks the marker up.
 */
const selectWithMarker =
	(existing: SelectFn | undefined): SelectFn =>
	(args) => {
		const select = existing?.(args) ?? args.select;

		if (select === undefined) {
			return undefined;
		}

		if (!isExcludeSelect(select)) {
			return { ...select, [MANAGED_BY]: true };
		}

		const { [MANAGED_BY]: _marker, ...rest } = select;

		return Object.keys(rest).length > 0 ? rest : select;
	};

const excludeManaged =
	(access: Access | undefined): Access =>
	async (args) => {
		const result = access ? await access(args) : Boolean(args.req.user);

		if (result === false) {
			return false;
		}

		return result === true ? UNMANAGED : { and: [result, UNMANAGED] };
	};

const listUnmanaged =
	(filter: BaseFilter | undefined): BaseFilter =>
	async (args) => {
		const existing = await filter?.(args);

		return existing ? { and: [existing, UNMANAGED] } : UNMANAGED;
	};

/**
 * mcpx's key collection with flue's managed keys locked: the `managedBy`
 * marker, hidden from the list, never written by a client, never updated or
 * deleted through access control, and the plaintext key never read.
 */
export const augmentKeyCollection = (
	collection: CollectionConfig,
): CollectionConfig => {
	for (const name of ["apiKey", "user", "capabilities"]) {
		requireField(collection, name);
	}

	for (const name of ["apiKey", MANAGED_BY]) {
		const field = rootField(collection, name);

		if (field && field.type !== "text") {
			throw invalid(
				`The mcpx API key collection "${collection.slug}" defines "${name}" as a ${field.type} field; flue needs a text field.`,
			);
		}
	}

	const existing = rootField(collection, MANAGED_BY);

	const marker: Field = {
		name: MANAGED_BY,
		type: "text",
		index: true,
		// Hidden from the admin only: `hidden` would strip it from reads and queries.
		admin: { hidden: true },
		access: { create: () => false, update: () => false },
	};

	const fields = mapRootFields(collection.fields, (field) =>
		isNamed(field, "apiKey") && field.type === "text"
			? {
					...field,
					access: {
						...field.access,
						read: lockApiKeyRead(collection.slug, field.access?.read),
					},
				}
			: field,
	);

	return {
		...collection,
		admin: {
			...collection.admin,
			/*
			 * A rich text relationship or link to a key is populated by reads that
			 * skip field access, which would carry the plaintext along.
			 */
			enableRichTextLink: false,
			enableRichTextRelationship: false,
			baseFilter: listUnmanaged(
				collection.admin?.baseFilter ??
					// Payload ignores this once `baseFilter` is set, so it is carried over.
					// eslint-disable-next-line @typescript-eslint/no-deprecated
					collection.admin?.baseListFilter,
			),
		},
		access: {
			...collection.access,
			update: excludeManaged(collection.access?.update),
			delete: excludeManaged(collection.access?.delete),
		},
		select: selectWithMarker(collection.select),
		fields: existing ? fields : [...fields, marker],
	};
};

const entities = (
	collection: KeyCollection,
	capabilities: GroupField,
	namespace: "collections" | "globals",
): Record<string, CapabilityEntity> => {
	if (!capabilities.fields.some((field) => isNamed(field, namespace))) {
		return {};
	}

	const group = requireGroup(
		collection,
		capabilities.fields,
		`capabilities.${namespace}`,
	);

	return Object.fromEntries(
		group.fields
			.filter((field) => field.type === "group" && "name" in field)
			.map((field) => {
				const { name, label, fields } = field as GroupField & { name: string };

				return [
					typeof label === "string" ? label : name,
					{
						field: name,
						operations: fields
							.filter((sub) => sub.type === "checkbox")
							.map((sub) => sub.name),
					},
				];
			}),
	);
};

/**
 * The checkboxes of mcpx's key collection. mcpx names each entity group after
 * the field name and labels it with the slug.
 */
export const capabilityFields = (
	collection: KeyCollection,
): CapabilityFieldMap => {
	const capabilities = requireGroup(
		collection,
		rootFields(collection.fields),
		"capabilities",
	);
	const tools = capabilities.fields.find((field) => isNamed(field, "tools"));

	return {
		collections: entities(collection, capabilities, "collections"),
		globals: entities(collection, capabilities, "globals"),
		tools:
			tools?.type === "group"
				? tools.fields
						.filter((field) => field.type === "checkbox")
						.map((field) => field.name)
				: [],
	};
};

/**
 * Refuses a grant mcpx offers no checkbox for and a grant without the one it
 * requires, naming the agent and the path. Warns where an ambient agent may
 * delete, as nobody but the agent user can approve its calls.
 */
export const validateGrants = (
	map: CapabilityFieldMap,
	agents: FlueAgentConfig[],
	logger: Pick<StartupLogger, "warn">,
): void => {
	for (const agent of agents) {
		const refuse = (path: string, reason: string): never => {
			throw invalid(`Agent "${agent.slug}": capabilities.${path} ${reason}`);
		};

		for (const namespace of ["collections", "globals"] as const) {
			for (const [slug, value] of Object.entries(
				agent.capabilities[namespace] ?? {},
			)) {
				const grant = value as FlueCollectionGrant;

				for (const operation of GRANTS.filter((name) => grant[name])) {
					const path = `${namespace}.${slug}.${operation}`;
					const required = REQUIRES[operation];

					if (!map[namespace][slug]?.operations.includes(operation)) {
						refuse(
							path,
							"has no checkbox on the mcpx API keys. Expose it in mcpx's options.",
						);
					}

					if (required && !grant[required]) {
						refuse(path, `needs ${namespace}.${slug}.${required} as well.`);
					}
				}
			}
		}

		for (const [name, granted] of Object.entries(
			agent.capabilities.tools ?? {},
		)) {
			if (granted && !map.tools.includes(name)) {
				refuse(`tools.${name}`, "is not an mcpx tool.");
			}
		}

		if (
			agent.ambient &&
			Object.values(agent.capabilities.collections ?? {}).some(
				(grant) => grant.delete,
			)
		) {
			logger.warn(
				`[payloadcms-flue] Agent "${agent.slug}" runs ambient and may delete: each delete waits for the agent user to approve it.`,
			);
		}
	}
};
