import { APIError, Forbidden, NotFound } from "payload";

import { slugsFor } from "./shared.js";

import type { McpxOperation } from "./shared.js";
import type { DocumentId, EntityRef, ResolvedEntity } from "../entity.js";
import type { McpxToolScope } from "../types.js";
import type { TypedLocale } from "payload";

export const refOf = (target: ResolvedEntity): EntityRef => ({
	kind: target.kind,
	slug: target.slug,
});

/**
 * A raw input shape leaves no top-level `.refine` to express "exactly one of
 * collection and global", so the rule is enforced here, with a message naming
 * the offending arguments.
 */
export const resolveEntity = (
	scope: McpxToolScope,
	args: { collection?: string | undefined; global?: string | undefined },
	operation: McpxOperation,
): ResolvedEntity => {
	const { collection, global } = args;
	const allowedSlugs = slugsFor(scope, operation);

	if (collection !== undefined && global !== undefined) {
		throw new APIError('Pass either "collection" or "global", not both.', 400);
	}

	if (collection === undefined && global === undefined) {
		throw new APIError(
			'One of "collection" or "global" is required. Call listCapabilities to see which slugs are available.',
			400,
		);
	}

	if (collection !== undefined) {
		const found = scope.req.payload.collections[collection];

		if (!allowedSlugs.collections.includes(collection) || !found) {
			throw new Forbidden(scope.req.t);
		}

		return { kind: "collection", slug: collection, config: found.config };
	}

	const slug = global as string;
	/*
	 * `payload.globals` is `{ config: SanitizedGlobalConfig[] }`, an array,
	 * not the slug-keyed map `payload.collections` is.
	 */
	const found = scope.req.payload.globals.config.find(
		(candidate) => candidate.slug === slug,
	);

	if (!allowedSlugs.globals.includes(slug) || !found) {
		throw new Forbidden(scope.req.t);
	}

	return { kind: "global", slug, config: found };
};

/**
 * Checks `id` against the resolved target. A collection document needs one; a
 * global is a singleton and must not carry one. The schema cannot express the
 * dependency, so it is stated here and in every affected tool description.
 */
export const requireIdFor = (
	target: ResolvedEntity,
	id: DocumentId | undefined,
): DocumentId | undefined => {
	if (target.kind === "collection" && id === undefined) {
		throw new APIError(
			`"id" is required when "collection" is "${target.slug}".`,
			400,
		);
	}

	if (target.kind === "global" && id !== undefined) {
		throw new APIError(
			`"id" must be omitted when "global" is "${target.slug}"; a global is a singleton.`,
			400,
		);
	}

	return target.kind === "collection" ? id : undefined;
};

/** The value a client read back is a string; what it meets may be a Date. */
export const sameInstant = (left: unknown, right: string): boolean =>
	typeof left === "string" &&
	new Date(left).getTime() === new Date(right).getTime();

/**
 * Reads the current draft in a fixed locale with no fallback, which is the
 * shape that may be written back or validated without mixing locales.
 */
export const readDraft = async (
	scope: McpxToolScope,
	args: {
		target: ResolvedEntity;
		id?: DocumentId | undefined;
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
			id: args.id as DocumentId,
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
