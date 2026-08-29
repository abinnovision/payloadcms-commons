import { APIError, Forbidden } from "payload";

import { slugsFor } from "./shared.js";

import type { McpxOperation } from "./shared.js";
import type { TargetRef } from "../schema/index.js";
import type { McpxToolScope } from "../types.js";
import type { SanitizedCollectionConfig, SanitizedGlobalConfig } from "payload";

/**
 * Discriminated so a caller that must hand Payload a real config can narrow,
 * while one that only needs `flattenedFields` can ignore the discriminant.
 */
export type ResolvedTarget =
	| { kind: "collection"; slug: string; config: SanitizedCollectionConfig }
	| { kind: "global"; slug: string; config: SanitizedGlobalConfig };

export const refOf = (target: ResolvedTarget): TargetRef => ({
	kind: target.kind,
	slug: target.slug,
});

/**
 * A raw input shape leaves no top-level `.refine` to express "exactly one of
 * collection and global", so the rule is enforced here, with a message naming
 * the offending arguments.
 */
export const resolveTarget = (
	scope: McpxToolScope,
	args: { collection?: string | undefined; global?: string | undefined },
	operation: McpxOperation,
): ResolvedTarget => {
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
	target: ResolvedTarget,
	id: number | string | undefined,
): number | string | undefined => {
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
