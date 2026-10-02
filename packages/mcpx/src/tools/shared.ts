import { z } from "zod";

import { canCreate, isLiveWrite } from "../capabilities.js";

import type { DocumentId } from "../entity.js";
import type {
	McpxExposedEntity,
	McpxScopeSlugs,
	McpxToolScope,
} from "../types.js";
import type { TypedLocale } from "payload";

export type Operation = "create" | "publish" | "read" | "versions" | "write";

/**
 * An out-of-scope slug fails schema validation before a handler runs, so a
 * client only ever sees what its key may touch.
 */
export const slugEnum = (slugs: string[]): z.ZodEnum<Record<string, string>> =>
	z.enum(slugs as [string, ...string[]]);

/** Payload's id type follows the adapter, so both forms are handed on as read. */
export const idSchema: z.ZodType<DocumentId> = z.union([
	z.string(),
	z.number(),
]);

type SlugEnum = z.ZodEnum<Record<string, string>>;

const slugsOf = (
	scope: McpxToolScope,
	key: keyof McpxScopeSlugs,
): { collections: string[]; globals: string[] } => ({
	collections: scope.collections[key],
	globals: scope.globals[key],
});

const slugsWhere = (
	scope: McpxToolScope,
	predicate: (entity: McpxExposedEntity) => boolean,
	allowed: { collections: string[]; globals: string[] },
): string[] => {
	const pick = (entities: McpxExposedEntity[], slugs: string[]): string[] =>
		entities
			.filter((entity) => slugs.includes(entity.slug) && predicate(entity))
			.map((entity) => entity.slug);

	return [
		...pick(scope.exposure.collections, allowed.collections),
		...pick(scope.exposure.globals, allowed.globals),
	];
};

/**
 * Slugs this key may write but never create in, because their documents are
 * files. Collection-only, since nothing creates a global either way.
 */
export const patchOnlySlugs = (scope: McpxToolScope): string[] =>
	slugsWhere(scope, (entity) => !canCreate(entity), {
		collections: scope.collections.writable,
		globals: [],
	});

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
	collection: z.ZodOptional<SlugEnum>;
	global: z.ZodOptional<SlugEnum>;
};
type IdShape = { id: z.ZodOptional<typeof idSchema> };
type LocaleShape = { locale: z.ZodOptional<SlugEnum> };
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

/** The one list the shape helpers and {@link resolveEntity} both read. */
export const slugsFor = (
	scope: McpxToolScope,
	operation: Operation,
): { collections: string[]; globals: string[] } => {
	switch (operation) {
		case "create":
			return {
				collections: slugsWhere(scope, canCreate, {
					collections: scope.collections.writable,
					globals: [],
				}),
				// A global always exists, so nothing creates one.
				globals: [],
			};
		case "publish":
			return slugsOf(scope, "publishable");
		case "read":
			return slugsOf(scope, "readable");
		case "versions":
			// Version history is a read, of entities that keep one and expose it.
			return {
				collections: slugsWhere(scope, (entity) => entity.hasVersions, {
					collections: scope.collections.readable,
					globals: [],
				}),
				globals: slugsWhere(scope, (entity) => entity.hasVersions, {
					collections: [],
					globals: scope.globals.readable,
				}),
			};
		case "write":
			return slugsOf(scope, "writable");
	}
};

/**
 * The slugs of {@link slugsFor} `"versions"` that also have drafts. Only they
 * have `_status` on their versions, so only they can be queried by status.
 */
export const draftVersionSlugs = (
	scope: McpxToolScope,
): { collections: string[]; globals: string[] } => {
	const { collections, globals } = slugsFor(scope, "versions");

	return {
		collections: slugsWhere(scope, (entity) => entity.hasDrafts, {
			collections,
			globals: [],
		}),
		globals: slugsWhere(scope, (entity) => entity.hasDrafts, {
			collections: [],
			globals,
		}),
	};
};

/** Slugs reachable by `operation` whose writes go live, because they have no draft to write. */
export const liveWriteSlugs = (
	scope: McpxToolScope,
	operation: "create" | "write",
): string[] => slugsWhere(scope, isLiveWrite, slugsFor(scope, operation));

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
 * required, so a deployment without globals sees an unchanged schema. Only the
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
		return widen<EntityShape>({ collection: slugEnum(collections) });
	}

	if (collections.length === 0) {
		return widen<EntityShape>({ global: slugEnum(globals) });
	}

	const global = slugEnum(globals).optional();

	return widen<EntityShape>({
		collection: slugEnum(collections).optional(),
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

/** For the reads that fall back to the default locale, unlike the writes. */
export const READ_LOCALE_DESCRIPTION =
	"Default: the default locale. A value missing in this locale is shown from the default locale.";

export const localeShape = (
	scope: McpxToolScope,
	options: { required: boolean; description?: string },
): LocaleShape => {
	if (!scope.localization) {
		return widen<LocaleShape>({});
	}

	const enumerated = z.enum(
		scope.localization.locales as [string, ...string[]],
	);
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
 * The locale to operate on: the explicit argument, else the request's, else
 * the default. `undefined` when localization is off.
 */
export const localeOf = (
	scope: McpxToolScope,
	locale: string | undefined,
): TypedLocale | undefined => {
	if (!scope.localization) {
		return undefined;
	}

	const { locales, defaultLocale } = scope.localization;
	const requested = locale ?? scope.req.locale;

	return requested && locales.includes(requested) ? requested : defaultLocale;
};
