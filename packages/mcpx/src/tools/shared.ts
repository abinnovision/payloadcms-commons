import { z } from "zod";

import { acceptsFiles } from "../upload/file.js";

import type { DocumentId } from "../entity.js";
import type {
	McpxExposedEntity,
	McpxScopeSlugs,
	McpxToolScope,
} from "../types.js";

export type Operation =
	"create" | "delete" | "publish" | "read" | "versions" | "write";

/**
 * A value outside the list fails schema validation before a handler runs, so a
 * client only ever sees what its key may touch.
 */
export const stringEnum = (
	values: string[],
): z.ZodEnum<Record<string, string>> => z.enum(values as [string, ...string[]]);

/**
 * Payload's id type follows the adapter, so both forms are handed on as read.
 */
export const idSchema: z.ZodType<DocumentId> = z.union([
	z.string(),
	z.number(),
]);

type StringEnum = z.ZodEnum<Record<string, string>>;

const slugsOf = (
	scope: McpxToolScope,
	key: keyof McpxScopeSlugs,
): { collections: string[]; globals: string[] } => ({
	collections: scope.collections[key],
	globals: scope.globals[key],
});

export const slugsWhere = (
	scope: McpxToolScope,
	predicate: (entity: McpxExposedEntity) => boolean,
	allowed: { collections: string[]; globals: string[] },
): { collections: string[]; globals: string[] } => {
	const pick = (entities: McpxExposedEntity[], slugs: string[]): string[] =>
		entities
			.filter((entity) => slugs.includes(entity.slug) && predicate(entity))
			.map((entity) => entity.slug);

	return {
		collections: pick(scope.exposure.collections, allowed.collections),
		globals: pick(scope.exposure.globals, allowed.globals),
	};
};

/**
 * Collections this key may write but not create in: upload collections whose
 * files MCP does not accept. Nothing creates a global either way.
 */
export const patchOnlySlugs = (scope: McpxToolScope): string[] => {
	const creatable = slugsFor(scope, "create").collections;

	return scope.collections.writable.filter((slug) => !creatable.includes(slug));
};

/*
 * The supersets the shape helpers below produce. Which keys a helper emits
 * depends on the scope (`global` is left out when the key reaches no global,
 * `locale` when localization is off), so no single branch describes what a
 * handler must cope with. A tool's arguments are inferred from these types, so
 * shape and arguments cannot drift apart. The cross-field rules they cannot
 * state are enforced by `resolveEntity` and `resolveDocument` at call time.
 */
/* eslint-disable @typescript-eslint/consistent-type-definitions */
type EntityShape = {
	collection: z.ZodOptional<StringEnum>;
	global: z.ZodOptional<StringEnum>;
};
type IdShape = { id: z.ZodOptional<typeof idSchema> };
type LocaleShape = { locale: z.ZodOptional<StringEnum> };
type DepthShape = { depth: z.ZodOptional<z.ZodNumber> };
/* eslint-enable @typescript-eslint/consistent-type-definitions */

/*
 * One scope-dependent branch of a superset. It may omit a key or emit the
 * required form of an optional one, but cannot add a key or change a type,
 * since that would let the shape and its inferred arguments drift apart.
 */
type Branch<Full extends z.ZodRawShape> = {
	[K in keyof Full]?: Full[K] extends z.ZodOptional<
		infer Inner extends z.core.$ZodType
	>
		? Full[K] | Inner
		: Full[K];
};

// Unchecked because the runtime shape varies; `Branch` guards it.
export const widen = <Full extends z.ZodRawShape>(branch: Branch<Full>): Full =>
	branch as unknown as Full;

/**
 * The one list the shape helpers and {@link resolveEntity} both read.
 */
export const slugsFor = (
	scope: McpxToolScope,
	operation: Operation,
): { collections: string[]; globals: string[] } => {
	switch (operation) {
		case "create":
			// A global always exists, so nothing creates one.
			return slugsWhere(
				scope,
				(entity) =>
					entity.write &&
					(!entity.isUpload || acceptsFiles(scope, entity.slug)),
				{ collections: scope.collections.writable, globals: [] },
			);
		case "delete":
			// Globals are never deletable.
			return { collections: scope.collections.deletable, globals: [] };
		case "publish":
			return slugsOf(scope, "publishable");
		case "read":
			return slugsOf(scope, "readable");
		case "versions":
			// Version history is a read, of entities that keep one and expose it.
			return slugsWhere(
				scope,
				(entity) => entity.hasVersions,
				slugsOf(scope, "readable"),
			);
		case "write":
			return slugsOf(scope, "writable");
	}
};

/**
 * Whether `operation` reaches any collection or global.
 */
export const reaches = (
	scope: McpxToolScope,
	operation: Operation,
): boolean => {
	const { collections, globals } = slugsFor(scope, operation);

	return collections.length + globals.length > 0;
};

/**
 * Slugs reachable by `operation` whose writes go live, because they have no
 * draft to write.
 */
export const liveWriteSlugs = (
	scope: McpxToolScope,
	operation: "create" | "write",
): string[] => {
	const { collections, globals } = slugsWhere(
		scope,
		(entity) => entity.liveWrite,
		slugsFor(scope, operation),
	);

	return [...collections, ...globals];
};

/**
 * Stated on the tools that write, since a client calling them must know before
 * the call which writes are public.
 */
export const liveWriteSentence = (
	scope: McpxToolScope,
	operation: "create" | "write",
): string => {
	const live = liveWriteSlugs(scope, operation);

	return live.length === 0
		? "Every write is saved as a draft."
		: `Writes to ${live.join(", ")} go live immediately. Every other write is saved as a draft.`;
};

/**
 * With no reachable global, `global` is left out and `collection` stays
 * required, so a deployment without globals gets no extra argument. Only the
 * mixed case makes either optional, and the handler enforces exclusivity there.
 * `globalRule` states that rule on `global` for a tool without an `id`.
 */
export const entityShape = (
	scope: McpxToolScope,
	operation: Operation,
	globalRule?: string,
): EntityShape => {
	const { collections, globals } = slugsFor(scope, operation);

	if (globals.length === 0) {
		return widen<EntityShape>({ collection: stringEnum(collections) });
	}

	if (collections.length === 0) {
		return widen<EntityShape>({ global: stringEnum(globals) });
	}

	const global = stringEnum(globals).optional();

	return widen<EntityShape>({
		collection: stringEnum(collections).optional(),
		global: globalRule === undefined ? global : global.describe(globalRule),
	});
};

/**
 * Only a collection document has one. Optional in the mixed case, where
 * `resolveDocument` enforces the dependency and the description states it.
 */
export const idShape = (
	scope: McpxToolScope,
	operation: Operation,
): IdShape => {
	const { collections, globals } = slugsFor(scope, operation);

	if (collections.length === 0) {
		return widen<IdShape>({});
	}

	if (globals.length === 0) {
		return widen<IdShape>({ id: idSchema });
	}

	return widen<IdShape>({
		id: idSchema
			.optional()
			.describe('Required with "collection", omitted with "global".'),
	});
};

/**
 * For the reads that fall back to the default locale, unlike the writes.
 */
export const READ_LOCALE_DESCRIPTION =
	"Default: the default locale. A value missing in this locale is shown from the default locale.";

export const localeShape = (
	scope: McpxToolScope,
	options: { required: boolean; description?: string },
): LocaleShape => {
	if (!scope.localization) {
		return widen<LocaleShape>({});
	}

	const enumerated = stringEnum(scope.localization.locales);
	const locale = options.required ? enumerated : enumerated.optional();

	return widen<LocaleShape>({
		locale:
			options.description === undefined
				? locale
				: locale.describe(options.description),
	});
};

/**
 * Defaults to 0 rather than Payload's own default: a client usually wants ids
 * it can write back, and populating a relation costs a query.
 */
export const depthShape = (scope: McpxToolScope): DepthShape => ({
	depth: z
		.number()
		.int()
		.min(0)
		.max(scope.limits.maxDepth)
		.optional()
		.describe(
			"Default 0. A relationship into a collection this key cannot read stays an id.",
		),
});

/**
 * For the writes that refuse a document changed since the client read it.
 */
export const expectedUpdatedAtShape = {
	expectedUpdatedAt: z
		.string()
		.optional()
		.describe(
			'"updatedAt" from your last read. Refused if the document changed since.',
		),
};

/**
 * `limit` is bounded by the configured ceiling, so the client sees it instead
 * of being clamped silently.
 */
export const pageShape = (scope: McpxToolScope) => ({
	limit: z
		.number()
		.int()
		.min(1)
		.max(scope.limits.maxLimit)
		.optional()
		.describe("Default 10."),
	page: z.number().int().min(1).optional(),
});

/**
 * The paging fields of a result.
 */
export const pageFields = (result: {
	totalDocs: number;
	page?: number | undefined;
	totalPages: number;
	limit: number;
	hasNextPage: boolean;
}) => ({
	totalDocs: result.totalDocs,
	page: result.page,
	totalPages: result.totalPages,
	limit: result.limit,
	hasNextPage: result.hasNextPage,
});

/**
 * The locale to operate on: the explicit argument, else the request's, else
 * the default. `undefined` when localization is off.
 */
export const localeOf = (
	scope: McpxToolScope,
	locale: string | undefined,
): string | undefined => {
	if (!scope.localization) {
		return undefined;
	}

	const { locales, defaultLocale } = scope.localization;
	const requested = locale ?? scope.req.locale;

	return requested && locales.includes(requested) ? requested : defaultLocale;
};
