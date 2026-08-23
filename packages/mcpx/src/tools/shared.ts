import { Forbidden, NotFound } from "payload";
import { z } from "zod";

import type { ToolScope } from "./types.js";
import type {
	LabelFunction,
	SanitizedCollectionConfig,
	StaticLabel,
	TypedLocale,
} from "payload";

const collectionEnum = (slugs: string[]): z.ZodEnum<Record<string, string>> =>
	z.enum(slugs as [string, ...string[]]);

const idSchema = z.union([z.string(), z.number()]).describe("Document id.");

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
 * Throws unless the key may perform `operation` on `slug`. The input schema
 * already limits the enum, so this only guards against a stale tool list.
 */
const ensureAllowed = (
	scope: ToolScope,
	slug: string,
	operation: "read" | "write",
): SanitizedCollectionConfig => {
	const allowed = operation === "read" ? scope.readable : scope.writable;
	const collection = scope.req.payload.collections[slug];

	if (!allowed.includes(slug) || !collection) {
		throw new Forbidden(scope.req.t);
	}

	return collection.config;
};

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
const readDraft = async (
	scope: ToolScope,
	args: {
		collection: string;
		id: number | string;
		locale: TypedLocale | undefined;
		privileged?: boolean;
	},
): Promise<Record<string, unknown>> => {
	const doc = (await scope.req.payload.findByID({
		collection: args.collection,
		id: args.id,
		depth: 0,
		draft: true,
		...(args.locale === undefined
			? {}
			: { locale: args.locale, fallbackLocale: false }),
		overrideAccess: args.privileged === true,
		showHiddenFields: args.privileged === true,
		disableErrors: true,
		req: scope.req,
	})) as null | Record<string, unknown>;

	if (!doc) {
		throw new NotFound(scope.req.t);
	}

	return doc;
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
	collectionEnum,
	depthShape,
	ensureAllowed,
	idSchema,
	localeOf,
	localeShape,
	readDraft,
	translateLabel,
};
