import { APIError, Forbidden, NotFound } from "payload";

import { documentLinks } from "./links.js";
import { slugsFor } from "./shared.js";
import { definedProps } from "../guards.js";
import { errorResult, jsonResult } from "../result.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";

import type { Operation } from "./shared.js";
import type {
	DocumentId,
	DocumentRef,
	ResolvedCollection,
	ResolvedEntity,
} from "../entity.js";
import type { McpxToolScope } from "../types.js";
import type { PublishBlocker } from "../write/publish-blockers.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
	File,
	Payload,
	PayloadRequest,
	SanitizedGlobalConfig,
} from "payload";

/**
 * `payload.globals` is `{ config: SanitizedGlobalConfig[] }`, an array, not the
 * slug-keyed map `payload.collections` is.
 */
export const globalConfig = (
	payload: Payload,
	slug: string,
): SanitizedGlobalConfig | undefined =>
	payload.globals.config.find((candidate) => candidate.slug === slug);

/**
 * For a tool that takes a collection and no global, so the result needs no
 * check for one.
 */
export const resolveCollection = (
	scope: McpxToolScope,
	slug: string,
	operation: Operation,
): ResolvedCollection => {
	const found = scope.req.payload.collections[slug]?.config;

	if (!slugsFor(scope, operation).collections.includes(slug) || !found) {
		throw new Forbidden(scope.req.t);
	}

	return { kind: "collection", slug, config: found };
};

/**
 * A raw input shape leaves no top-level `.refine` to express "exactly one of
 * collection and global", so the rule is enforced here, with a message naming
 * the offending arguments.
 */
export const resolveEntity = (
	scope: McpxToolScope,
	args: { collection?: string | undefined; global?: string | undefined },
	operation: Operation,
): ResolvedEntity => {
	const { collection, global } = args;

	if (collection !== undefined && global !== undefined) {
		throw new APIError('Pass either "collection" or "global", not both.', 400);
	}

	if (collection !== undefined) {
		return resolveCollection(scope, collection, operation);
	}

	if (global !== undefined) {
		const found = globalConfig(scope.req.payload, global);

		if (!slugsFor(scope, operation).globals.includes(global) || !found) {
			throw new Forbidden(scope.req.t);
		}

		return { kind: "global", slug: global, config: found };
	}

	throw new APIError(
		'One of "collection" or "global" is required. Call listCapabilities to see which slugs are available.',
		400,
	);
};

/**
 * Resolves the entity and checks `id` against it. A collection document needs
 * one; a global is a singleton and must not carry one. The schema cannot
 * express that, so it is checked here and stated on the `id` parameter.
 */
export const resolveDocument = (
	scope: McpxToolScope,
	args: {
		collection?: string | undefined;
		global?: string | undefined;
		id?: DocumentId | undefined;
	},
	operation: Operation,
): DocumentRef => {
	const target = resolveEntity(scope, args, operation);

	if (target.kind === "global") {
		if (args.id !== undefined) {
			throw new APIError(
				`"id" must be omitted when "global" is "${target.slug}"; a global is a singleton.`,
				400,
			);
		}

		return target;
	}

	if (args.id === undefined) {
		throw new APIError(
			`"id" is required when "collection" is "${target.slug}".`,
			400,
		);
	}

	return { ...target, id: args.id };
};

/**
 * What a response names its subject by: a document's id, or a global's slug.
 */
export const identityOf = (
	target: DocumentRef,
): { id: DocumentId } | { global: string } =>
	target.kind === "collection" ? { id: target.id } : { global: target.slug };

/**
 * The fields every write result starts with, read from the saved `doc`.
 */
export const documentSummary = (
	target: ResolvedEntity,
	doc: Record<string, unknown>,
) => ({
	...(target.kind === "collection"
		? { id: doc["id"] }
		: { global: target.slug }),
	status: doc["_status"],
	updatedAt: doc["updatedAt"],
});

/**
 * Names the blockers of a check, and whether the check itself failed.
 */
export const blockerFields = (
	result: { blockers: PublishBlocker[]; unavailable?: true },
	key: "otherLocaleBlockers" | "publishBlockers",
) => ({
	...(result.blockers.length > 0 ? { [key]: result.blockers } : {}),
	...(result.unavailable ? { [`${key}Unavailable`]: true } : {}),
});

/**
 * What a tool that wrote a document returns: the document, re-read privileged
 * in `locale`, with its links and publish blockers. `extra` follows them.
 */
export const writtenResult = async (
	scope: McpxToolScope,
	args: {
		target: DocumentRef;
		locale: string | undefined;
		extra?: Record<string, unknown>;
	},
): Promise<CallToolResult> => {
	const { target, locale } = args;
	const saved = await readDraft(scope, { target, locale, privileged: true });
	const validation = await collectPublishBlockers(scope.req, {
		doc: saved,
		entity: target,
	});

	return jsonResult({
		...documentSummary(target, saved),
		...(await documentLinks(scope.req, { target, doc: saved, locale })),
		...blockerFields(validation, "publishBlockers"),
		...args.extra,
	});
};

// The client's value is a string, but the stored one may be a Date.
const sameInstant = (left: unknown, right: string): boolean =>
	(typeof left === "string" || left instanceof Date) &&
	new Date(left).getTime() === new Date(right).getTime();

/**
 * Refuses a write when the document changed since the client read it.
 */
export const staleReadResult = (
	doc: Record<string, unknown>,
	expectedUpdatedAt: string | undefined,
	message: string,
): CallToolResult | undefined =>
	expectedUpdatedAt !== undefined &&
	!sameInstant(doc["updatedAt"], expectedUpdatedAt)
		? errorResult(message, { updatedAt: doc["updatedAt"] })
		: undefined;

/**
 * Reads the current draft in a fixed locale with no fallback, which is the
 * shape that may be written back or validated without mixing locales.
 */
export const readDraft = async (
	scope: McpxToolScope,
	args: {
		target: DocumentRef;
		locale: string | undefined;
		privileged?: boolean;
		trash?: boolean;
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
			id: args.target.id,
			disableErrors: true,
			...(args.trash ? { trash: true } : {}),
		})) as null | Record<string, unknown>;

		if (!doc) {
			throw new NotFound(scope.req.t);
		}

		return doc;
	}

	/*
	 * `disableErrors` stays off for a global so Payload can tell the cases apart:
	 * denied access throws `NotFound`, while a global that was never saved comes
	 * back empty. The empty document is a valid starting point, since refusing it
	 * would make the first write to a global impossible.
	 */
	return await payload.findGlobal({
		...shared,
		slug: args.target.slug,
	});
};

/**
 * Updates a collection document or a global with no fallback locale, so a value
 * missing in the written locale is not backfilled from another and persisted.
 */
export const updateTarget = async (
	scope: McpxToolScope,
	target: DocumentRef,
	write: {
		data: Record<string, unknown>;
		draft: boolean;
		locale: string | undefined;
		publishSpecificLocale?: string | undefined;
		file?: File | undefined;
	},
): Promise<void> => {
	const { payload } = scope.req;
	const { data, draft, file, ...optional } = write;
	const shared = {
		data,
		depth: 0,
		draft,
		fallbackLocale: false as const,
		overrideAccess: false,
		req: scope.req,
		...definedProps(optional),
	};

	if (target.kind === "collection") {
		await payload.update({
			...shared,
			...definedProps({ file }),
			collection: target.slug,
			id: target.id,
		});
	} else {
		await payload.updateGlobal({ ...shared, slug: target.slug });
	}
};

/**
 * Runs `run`, then puts back the request's locale and fallback locale, which
 * Payload's local API assigns in place.
 */
export const withRequestLocale = async <T>(
	req: PayloadRequest,
	run: () => Promise<T>,
): Promise<T> => {
	const { fallbackLocale, locale } = req;

	try {
		return await run();
	} finally {
		if (locale !== undefined) {
			req.locale = locale;
		}

		if (fallbackLocale !== undefined) {
			req.fallbackLocale = fallbackLocale;
		}
	}
};

/**
 * {@link collectPublishBlockers} over the draft of each locale, each blocker
 * tagged with its locale. Locales run in turn because hooks share `req`, and
 * the request's locale and fallback locale are restored afterwards.
 */
export const collectLocaleBlockers = async (
	scope: McpxToolScope,
	target: DocumentRef,
	locales: readonly string[],
): Promise<{ blockers: PublishBlocker[]; unavailable?: true }> => {
	const { req } = scope;
	const blockers: PublishBlocker[] = [];

	const unavailable = await withRequestLocale(req, async () => {
		let failed = false;

		for (const locale of locales) {
			try {
				// eslint-disable-next-line no-await-in-loop
				const doc = await readDraft(scope, {
					target,
					locale,
					privileged: true,
				});
				// eslint-disable-next-line no-await-in-loop
				const result = await collectPublishBlockers(req, {
					doc,
					entity: target,
				});

				failed ||= result.unavailable === true;
				blockers.push(
					...result.blockers.map((entry) => ({ ...entry, locale })),
				);
			} catch (error) {
				req.payload.logger.warn(
					`[payloadcms-mcpx] Could not read the ${target.slug} draft in ${locale}: ${error instanceof Error ? error.message : "unknown error"}`,
				);
				failed = true;
			}
		}

		return failed;
	});

	return { blockers, ...(unavailable ? { unavailable: true as const } : {}) };
};
