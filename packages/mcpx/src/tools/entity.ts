import { APIError, Forbidden, NotFound } from "payload";

import { slugsFor } from "./shared.js";
import { errorResult } from "../result.js";

import type { McpxOperation } from "./shared.js";
import type {
	DocumentId,
	DocumentRef,
	EntityRef,
	ResolvedEntity,
} from "../entity.js";
import type { McpxToolScope } from "../types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
 * Resolves the entity and checks `id` against it. A collection document needs
 * one; a global is a singleton and must not carry one. The schema cannot
 * express that, so it is checked here and stated in every affected tool
 * description.
 */
export const resolveDocument = (
	scope: McpxToolScope,
	args: {
		collection?: string | undefined;
		global?: string | undefined;
		id?: DocumentId | undefined;
	},
	operation: McpxOperation,
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

/** What a response names its subject by: a document's id, or a global's slug. */
export const identityOf = (
	target: ResolvedEntity,
	id: unknown,
): { id: unknown } | { global: string } =>
	target.kind === "collection" ? { id } : { global: target.slug };

// The client's value is a string, but the stored one may be a Date.
const sameInstant = (left: unknown, right: string): boolean =>
	typeof left === "string" &&
	new Date(left).getTime() === new Date(right).getTime();

/** Refuses a write when the document changed since the client read it. */
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
			id: args.target.id,
			disableErrors: true,
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
