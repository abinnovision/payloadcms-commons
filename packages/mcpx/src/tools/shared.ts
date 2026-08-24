import { NotFound } from "payload";
import { z } from "zod";

import type { ResolvedTarget } from "./target.js";
import type { ToolScope } from "./types.js";
import type { LabelFunction, StaticLabel, TypedLocale } from "payload";

const slugEnum = (slugs: string[]): z.ZodEnum<Record<string, string>> =>
	z.enum(slugs as [string, ...string[]]);

const idSchema = z.union([z.string(), z.number()]).describe("Document id.");

const slugsFor = (
	scope: ToolScope,
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
const targetShape = (
	scope: ToolScope,
	operation: "read" | "write",
	descriptions: { collection: string; global: string },
): z.ZodRawShape => {
	const { collections, globals } = slugsFor(scope, operation);

	if (globals.length === 0) {
		return {
			collection: slugEnum(collections).describe(descriptions.collection),
		};
	}

	if (collections.length === 0) {
		return { global: slugEnum(globals).describe(descriptions.global) };
	}

	return {
		collection: slugEnum(collections)
			.optional()
			.describe(descriptions.collection),
		global: slugEnum(globals).optional().describe(descriptions.global),
	};
};

/**
 * The `id` argument, which only a collection document has. Omitted when the key
 * can reach no collection, required when it can reach no global, and optional
 * in between, where `requireIdFor` enforces the dependency.
 */
const idShape = (
	scope: ToolScope,
	operation: "read" | "write",
): z.ZodRawShape => {
	const { collections, globals } = slugsFor(scope, operation);

	if (collections.length === 0) {
		return {};
	}

	if (globals.length === 0) {
		return { id: idSchema };
	}

	return {
		id: idSchema
			.optional()
			.describe(
				'Document id. Required with "collection"; must be omitted with "global".',
			),
	};
};

/**
 * The `locale` argument, present only when localization is configured.
 */
const localeShape = (
	scope: ToolScope,
	options: { required: boolean; description: string },
): z.ZodRawShape => {
	if (!scope.locales) {
		return {};
	}

	const locale = z.enum(scope.locales as [string, ...string[]]);

	return {
		locale: (options.required ? locale : locale.optional()).describe(
			options.description,
		),
	};
};

const depthShape = (scope: ToolScope): z.ZodRawShape => ({
	depth: z
		.number()
		.int()
		.min(0)
		.max(scope.options.limits.maxDepth)
		.optional()
		.describe(
			`Relationship population depth. Default 0, at most ${String(scope.options.limits.maxDepth)}.`,
		),
});

/**
 * The locale to operate on: the explicit argument, else the request's, else
 * the default. `undefined` when localization is off.
 */
const localeOf = (
	scope: ToolScope,
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
const readTarget = async (
	scope: ToolScope,
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

	// `disableErrors` stays off for a global so Payload distinguishes the two
	// cases itself: denied access throws `NotFound`, while a global that has
	// simply never been saved comes back as an empty document. That empty
	// document is a valid starting point — a global always exists conceptually,
	// so refusing it would make the first write to one impossible.
	return await payload.findGlobal({
		...shared,
		slug: args.target.slug,
	});
};

/**
 * Resolves a collection label for the request's language.
 */
const translateLabel = (
	scope: ToolScope,
	label: LabelFunction | StaticLabel | undefined,
	fallback: string,
): string => {
	const { i18n, t } = scope.req;
	const resolved = typeof label === "function" ? label({ i18n, t }) : label;

	if (typeof resolved === "string") {
		return resolved;
	}

	if (resolved && typeof resolved === "object") {
		return resolved[i18n.language] ?? Object.values(resolved)[0] ?? fallback;
	}

	return fallback;
};

export {
	slugEnum,
	depthShape,
	idSchema,
	idShape,
	localeOf,
	localeShape,
	readTarget,
	targetShape,
	translateLabel,
};
