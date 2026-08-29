import { NotFound } from "payload";
import { z } from "zod";

import { canPublish, isLiveWrite } from "../capabilities.js";
import { translateStatic } from "../i18n.js";

import type { ResolvedTarget } from "./target.js";
import type { McpxExposedEntity, McpxToolScope } from "../types.js";
import type { LabelFunction, StaticLabel, TypedLocale } from "payload";

export type McpxOperation = "publish" | "read" | "write";

/**
 * An out-of-scope slug fails schema validation before a handler runs, so a
 * client only ever sees what its key may touch.
 */
export const slugEnum = (slugs: string[]): z.ZodEnum<Record<string, string>> =>
	z.enum(slugs as [string, ...string[]]);

/** Payload's id type follows the adapter, so both forms are handed on as read. */
export const idSchema = z
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

/** The value a client read back is a string; what it meets may be a Date. */
export const sameInstant = (left: unknown, right: string): boolean =>
	typeof left === "string" &&
	new Date(left).getTime() === new Date(right).getTime();

/*
 * The supersets the shape helpers below produce. Which keys a helper actually
 * emits depends on the scope. `global` is left out when the key can reach no
 * global, `locale` when localization is off, so no single branch describes
 * what a handler must cope with. These types do, and a tool's arguments are
 * inferred from them, which is what keeps the two from drifting apart. The
 * cross-field rules they cannot state ("exactly one of collection and global",
 * "id required with collection") are enforced by `resolveTarget` and
 * `requireIdFor` at call time.
 */
/* eslint-disable @typescript-eslint/consistent-type-definitions */
type TargetShape = {
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

/** The one list the shape helpers and {@link resolveTarget} both read. */
export const slugsFor = (
	scope: McpxToolScope,
	operation: McpxOperation,
): { collections: string[]; globals: string[] } => {
	switch (operation) {
		case "publish":
			return {
				collections: scope.publishable,
				globals: scope.publishableGlobals,
			};
		case "read":
			return { collections: scope.readable, globals: scope.readableGlobals };
		case "write":
			return { collections: scope.writable, globals: scope.writableGlobals };
	}
};

/**
 * With no reachable global, `global` is left out and `collection` stays
 * required, so a deployment without globals sees an unchanged schema. Only the
 * mixed case makes either optional, and the handler enforces exclusivity there.
 */
export const targetShape = (
	scope: McpxToolScope,
	operation: McpxOperation,
	descriptions: { collection: string; global: string },
): TargetShape => {
	const { collections, globals } = slugsFor(scope, operation);

	if (globals.length === 0) {
		return widen<TargetShape>({
			collection: slugEnum(collections).describe(descriptions.collection),
		});
	}

	if (collections.length === 0) {
		return widen<TargetShape>({
			global: slugEnum(globals).describe(descriptions.global),
		});
	}

	return widen<TargetShape>({
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

/**
 * Reads the current draft in a fixed locale with no fallback, which is the
 * shape that may be written back or validated without mixing locales.
 */
export const readTarget = async (
	scope: McpxToolScope,
	args: {
		target: ResolvedTarget;
		id?: number | string | undefined;
		locale: TypedLocale | undefined;
		privileged?: boolean;
	},
): Promise<Record<string, unknown>> => {
	const { payload } = scope.req;
	const privileged = args.privileged === true;
	const shared = {
		depth: 0,
		draft: true,
		...(args.locale === undefined
			? {}
			: { locale: args.locale, fallbackLocale: false as const }),
		overrideAccess: privileged,
		showHiddenFields: privileged,
		req: scope.req,
	};

	if (args.target.kind === "collection") {
		const doc = (await payload.findByID({
			...shared,
			collection: args.target.slug,
			id: args.id as number | string,
			disableErrors: true,
		})) as null | Record<string, unknown>;

		if (!doc) {
			throw new NotFound(scope.req.t);
		}

		return doc;
	}

	/*
	 * `disableErrors` stays off for a global so Payload distinguishes the two
	 * cases itself: denied access throws `NotFound`, while a global that has
	 * simply never been saved comes back as an empty document. That empty
	 * document is a valid starting point, because a global always exists
	 * conceptually and refusing it would make the first write to one
	 * impossible.
	 */
	return await payload.findGlobal({
		...shared,
		slug: args.target.slug,
	});
};

export const translateLabel = (
	scope: McpxToolScope,
	label: LabelFunction | StaticLabel | undefined,
	fallback: string,
): string => {
	const { i18n, t } = scope.req;
	const resolved = typeof label === "function" ? label({ i18n, t }) : label;

	return translateStatic(resolved, i18n) ?? fallback;
};
