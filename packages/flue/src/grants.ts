import { invalid } from "./options.js";

import type { NormalizedOptions, StartupLogger } from "./options.js";
import type { FlueCollectionGrant } from "./types.js";
import type { CollectionConfig, Field, GroupField } from "payload";

/** The operations a grant may tick, each with the one it requires. */
const GRANTS = ["read", "write", "publish", "delete"] as const;
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
 * requires, naming the agent and the path, and an agent taking files when
 * mcpx offers no read checkbox for the files collection. Warns where an
 * ambient agent may delete, as nobody but the agent user can approve its
 * calls.
 */
export const validateGrants = (
	map: CapabilityFieldMap,
	settings: Pick<NormalizedOptions, "agents" | "files">,
	logger: Pick<StartupLogger, "warn">,
): void => {
	const { files } = settings;

	for (const agent of settings.agents) {
		const refuse = (path: string, reason: string): never => {
			throw invalid(`Agent "${agent.slug}": capabilities.${path} ${reason}`);
		};

		if (
			agent.files &&
			files &&
			!map.collections[files.collection]?.operations.includes("read")
		) {
			throw invalid(
				`Agent "${agent.slug}" takes files, but mcpx does not expose "${files.collection}". Add "${files.collection}": {} to mcpxPlugin({ collections }) so agents with files can read it.`,
			);
		}

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
