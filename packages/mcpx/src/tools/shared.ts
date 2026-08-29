import { NotFound } from "payload";
import { z } from "zod";

import { translateStatic } from "../i18n.js";

import type { ResolvedTarget } from "./target.js";
import type { McpxExposedEntity, McpxToolScope } from "../types.js";
import type { LabelFunction, StaticLabel, TypedLocale } from "payload";

export const slugEnum = (slugs: string[]): z.ZodEnum<Record<string, string>> =>
	z.enum(slugs as [string, ...string[]]);

export const idSchema = z
	.union([z.string(), z.number()])
	.describe("Document id.");

type SlugEnum = z.ZodEnum<Record<string, string>>;

/**
 * Slugs this key may write whose writes land live rather than as a draft,
 * which is what `allowLiveWrites` permits for an entity without versions.
 * Empty for every key that can only write drafts.
 */
export const liveWriteSlugs = (scope: McpxToolScope): string[] => {
	const live = (entities: McpxExposedEntity[], writable: string[]): string[] =>
		entities
			.filter(
				(entity) =>
					writable.includes(entity.slug) &&
					entity.allowLiveWrites &&
					!entity.hasDrafts,
			)
			.map((entity) => entity.slug);

	return [
		...live(scope.exposure.collections, scope.writable),
		...live(scope.exposure.globals, scope.writableGlobals),
	];
};

/**
 * The sentence the write tools and the server instructions end on: what a
 * write actually does for this key.
 */
export const draftSentence = (scope: McpxToolScope): string => {
	const live = liveWriteSlugs(scope);

	return live.length === 0
		? "Every write lands as a draft and is never published; publishing stays a human action in the admin panel."
		: `Writes land as drafts and are never published, except for ${live.join(", ")}, which have no drafts: a write there changes the live document immediately. Publishing anything else stays a human action in the admin panel.`;
};

/*
 * The supersets the shape helpers below produce. Which keys a helper actually
 * emits depends on the scope — `global` is left out when the key can reach no
 * global, `locale` when localization is off — so no single branch describes
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

/**
 * Widens one branch to the superset a handler sees. The widening itself is
 * unchecked — the runtime shape really does vary — so `Branch` checks what it
 * can around it.
 */
const widen = <Full extends z.ZodRawShape>(branch: Branch<Full>): Full =>
	branch as unknown as Full;

const slugsFor = (
	scope: McpxToolScope,
	operation: "read" | "write",
): { collections: string[]; globals: string[] } => ({
	collections: operation === "read" ? scope.readable : scope.writable,
	globals: operation === "read" ? scope.readableGlobals : scope.writableGlobals,
});

/**
 * The `collection` and `global` arguments.
 *
 * When the key can reach no global, `global` is left out of the shape entirely
 * and `collection` stays required, mirroring how {@link localeShape} omits
 * `locale` when localization is off. A deployment without globals therefore
 * sees exactly the schema it saw before. Only the mixed case makes either
 * argument optional, and the handler enforces the exclusivity there.
 */
export const targetShape = (
	scope: McpxToolScope,
	operation: "read" | "write",
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
 * The `id` argument, which only a collection document has. Omitted when the key
 * can reach no collection, required when it can reach no global, and optional
 * in between, where `requireIdFor` enforces the dependency.
 */
export const idShape = (
	scope: McpxToolScope,
	operation: "read" | "write",
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

/**
 * The `locale` argument, present only when localization is configured.
 */
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
	 * document is a valid starting point — a global always exists conceptually,
	 * so refusing it would make the first write to one impossible.
	 */
	return await payload.findGlobal({
		...shared,
		slug: args.target.slug,
	});
};

/**
 * Resolves a collection label for the request's language.
 */
export const translateLabel = (
	scope: McpxToolScope,
	label: LabelFunction | StaticLabel | undefined,
	fallback: string,
): string => {
	const { i18n, t } = scope.req;
	const resolved = typeof label === "function" ? label({ i18n, t }) : label;

	return translateStatic(resolved, i18n) ?? fallback;
};
