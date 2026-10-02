import {
	createDataloaderCacheKey,
	getDataLoader,
	isolateObjectProperty,
} from "payload";
import { z } from "zod";

import { canCreate, canPublish, isLiveWrite } from "../capabilities.js";

import type { DocumentId } from "../entity.js";
import type { McpxExposedEntity, McpxToolScope } from "../types.js";
import type { PayloadRequest, TypedLocale, TypeWithID } from "payload";

export type McpxOperation =
	"create" | "publish" | "read" | "versions" | "write";

/**
 * An out-of-scope slug fails schema validation before a handler runs, so a
 * client only ever sees what its key may touch.
 */
export const slugEnum = (slugs: string[]): z.ZodEnum<Record<string, string>> =>
	z.enum(slugs as [string, ...string[]]);

/** Payload's id type follows the adapter, so both forms are handed on as read. */
export const idSchema: z.ZodType<DocumentId> = z
	.union([z.string(), z.number()])
	.describe("Document id.");

type SlugEnum = z.ZodEnum<Record<string, string>>;

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
 * Slugs this key may write whose writes land live rather than as a draft. An
 * entity without versions has no draft to land on, so `write: "live"` there
 * makes every write a live one. Empty for every key that can only write drafts.
 */
const liveWriteSlugs = (scope: McpxToolScope): string[] =>
	slugsWhere(scope, isLiveWrite, {
		collections: scope.writable,
		globals: scope.writableGlobals,
	});

/**
 * Slugs this key may write but never create in, because their documents are
 * files. Collection-only, since nothing creates a global either way.
 */
export const patchOnlySlugs = (scope: McpxToolScope): string[] =>
	slugsWhere(scope, (entity) => !canCreate(entity), {
		collections: scope.writable,
		globals: [],
	});

/** Slugs this key may write and, separately, publish. */
const publishableWriteSlugs = (scope: McpxToolScope): string[] =>
	slugsWhere(scope, canPublish, {
		collections: scope.publishable,
		globals: scope.publishableGlobals,
	});

/**
 * What a write actually does for this key, and what it takes to make it public.
 * A live-write slug has no draft and no publish step; a publishable one has
 * both. Stated per key so a client is never told its writes are drafts while
 * they are not, nor that publishing is out of reach when it is not.
 */
export const draftSentence = (scope: McpxToolScope): string => {
	const live = liveWriteSlugs(scope);
	const publishable = publishableWriteSlugs(scope);

	const base =
		live.length === 0
			? "Every write lands as a draft."
			: `Writes land as drafts, except for ${live.join(", ")}, which have no drafts: a write there changes the live document immediately.`;

	const publishing =
		publishable.length === 0
			? "Nothing this key writes is ever published; publishing stays a human action in the admin panel."
			: `Publish a draft with publishDocument, which this key may do for ${publishable.join(", ")}. Publishing anything else stays a human action in the admin panel.`;

	return `${base} ${publishing}`;
};

/*
 * The supersets the shape helpers below produce. Which keys a helper actually
 * emits depends on the scope. `global` is left out when the key can reach no
 * global, `locale` when localization is off, so no single branch describes
 * what a handler must cope with. These types do, and a tool's arguments are
 * inferred from them, which is what keeps the two from drifting apart. The
 * cross-field rules they cannot state ("exactly one of collection and global",
 * "id required with collection") are enforced by `resolveEntity` and
 * `requireIdFor` at call time.
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

/**
 * One scope-dependent branch of a superset. It may leave a key out, and may
 * emit the required form of a key the superset marks optional, but it cannot
 * invent a key or change one's type: those are the ways a shape and the
 * arguments inferred from it would drift apart.
 */
type Branch<Full extends z.ZodRawShape> = {
	[K in keyof Full]?: Full[K] extends z.ZodOptional<
		infer Inner extends z.core.$ZodType
	>
		? Full[K] | Inner
		: Full[K];
};

/** Unchecked, because the runtime shape really does vary; `Branch` guards it. */
const widen = <Full extends z.ZodRawShape>(branch: Branch<Full>): Full =>
	branch as unknown as Full;

/** The one list the shape helpers and {@link resolveEntity} both read. */
export const slugsFor = (
	scope: McpxToolScope,
	operation: McpxOperation,
): { collections: string[]; globals: string[] } => {
	switch (operation) {
		case "create":
			return {
				collections: slugsWhere(scope, canCreate, {
					collections: scope.writable,
					globals: [],
				}),
				// A global always exists, so nothing creates one.
				globals: [],
			};
		case "publish":
			return {
				collections: scope.publishable,
				globals: scope.publishableGlobals,
			};
		case "read":
			return { collections: scope.readable, globals: scope.readableGlobals };
		case "versions":
			// Version history is a read, of entities that keep one.
			return {
				collections: slugsWhere(scope, (entity) => entity.hasVersions, {
					collections: scope.readable,
					globals: [],
				}),
				globals: slugsWhere(scope, (entity) => entity.hasVersions, {
					collections: [],
					globals: scope.readableGlobals,
				}),
			};
		case "write":
			return { collections: scope.writable, globals: scope.writableGlobals };
	}
};

/**
 * With no reachable global, `global` is left out and `collection` stays
 * required, so a deployment without globals sees an unchanged schema. Only the
 * mixed case makes either optional, and the handler enforces exclusivity there.
 */
export const entityShape = (
	scope: McpxToolScope,
	operation: McpxOperation,
	descriptions: { collection: string; global: string },
): EntityShape => {
	const { collections, globals } = slugsFor(scope, operation);

	if (globals.length === 0) {
		return widen<EntityShape>({
			collection: slugEnum(collections).describe(descriptions.collection),
		});
	}

	if (collections.length === 0) {
		return widen<EntityShape>({
			global: slugEnum(globals).describe(descriptions.global),
		});
	}

	return widen<EntityShape>({
		collection: slugEnum(collections)
			.optional()
			.describe(descriptions.collection),
		global: slugEnum(globals).optional().describe(descriptions.global),
	});
};

/**
 * Only a collection document has one. Optional in the mixed case, where
 * `requireIdFor` enforces the dependency.
 */
export const idShape = (
	scope: McpxToolScope,
	operation: McpxOperation,
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
			.describe(
				'Document id. Required with "collection"; must be omitted with "global".',
			),
	});
};

export const localeShape = (
	scope: McpxToolScope,
	options: { required: boolean; description: string },
): LocaleShape => {
	if (!scope.locales) {
		return widen<LocaleShape>({});
	}

	const locale = z.enum(scope.locales as [string, ...string[]]);

	return widen<LocaleShape>({
		locale: (options.required ? locale : locale.optional()).describe(
			options.description,
		),
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
			`Relationship population depth. Default 0, at most ${String(scope.limits.maxDepth)}.`,
		),
});

/**
 * Where the data loader's cache key holds the collection slug and document id,
 * found by probing rather than assumed. A layout the probe cannot read leaves
 * both at -1, which refuses every population.
 */
const LOADER_KEY = ((): { slug: number; id: number } => {
	const slug = "\u0000slug";
	const id = "\u0000id";
	const parts: unknown = JSON.parse(
		createDataloaderCacheKey({
			collectionSlug: slug,
			currentDepth: 0,
			depth: 0,
			docID: id,
			draft: false,
			fallbackLocale: false,
			locale: "",
			overrideAccess: false,
			showHiddenFields: false,
			transactionID: "",
		}),
	);

	return Array.isArray(parts)
		? { slug: parts.indexOf(slug), id: parts.indexOf(id) }
		: { slug: -1, id: -1 };
})();

/**
 * The request a read tool hands to Payload, populating relations only into
 * collections this key may read. Relationship and upload fields, joins and
 * rich text nodes all populate through `req.payloadDataLoader`, and the loader
 * runs its finds on the request it was made for, so a loader of its own on an
 * isolated request bounds every depth without touching the request custom
 * tools share.
 *
 * A refused relation resolves to its own id: relationship fields keep the id
 * when the loader answers with nothing, but rich text sets the node's value to
 * `null`, and the id is what depth 0 returns in both.
 */
export const readRequest = (scope: McpxToolScope): PayloadRequest => {
	const req = isolateObjectProperty(scope.req, "payloadDataLoader");
	const loader = getDataLoader(req);
	const load = loader.load.bind(loader);

	loader.load = (key) => {
		const parts = JSON.parse(key) as unknown[];
		const collection = parts[LOADER_KEY.slug];

		return typeof collection === "string" && scope.readable.includes(collection)
			? load(key)
			: Promise.resolve(parts[LOADER_KEY.id] as TypeWithID);
	};

	req.payloadDataLoader = loader;

	return req;
};

/**
 * The locale to operate on: the explicit argument, else the request's, else
 * the default. `undefined` when localization is off.
 */
export const localeOf = (
	scope: McpxToolScope,
	locale: string | undefined,
): TypedLocale | undefined => {
	if (!scope.locales) {
		return undefined;
	}

	const requested = locale ?? scope.req.locale;
	const chosen =
		requested && scope.locales.includes(requested)
			? requested
			: scope.defaultLocale;

	return chosen ?? undefined;
};
