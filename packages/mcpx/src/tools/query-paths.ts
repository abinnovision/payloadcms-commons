import { APIError, getLocalizedPaths } from "payload";

import { isPlainObject } from "../guards.js";

import type { McpxToolScope } from "../types.js";

/**
 * The paths of a `where`, found the way Payload's `validateQueryPaths` finds
 * them: `and` and `or` (any case) hold arrays of clauses, every other key is a
 * path.
 */
export const wherePaths = (where: unknown): string[] =>
	isPlainObject(where)
		? Object.entries(where).flatMap(([key, clause]) =>
				["and", "or"].includes(key.toLowerCase()) && Array.isArray(clause)
					? clause.flatMap(wherePaths)
					: [key],
			)
		: [];

/** The paths of a `sort`: a field name, `-` for descending, comma separated. */
export const sortPaths = (sort: string | undefined): string[] =>
	(sort ?? "")
		.split(",")
		.map((entry) => entry.trim().replace(/^-/, ""))
		.filter(Boolean);

/* Payload reads a double underscore as a dot, and `_id` as `id`. */
const normalise = (path: string): string =>
	path === "_id" ? "id" : path.replaceAll("__", ".");

/*
 * Whether Payload would read a document of a collection outside `readable`
 * while resolving `path`: a hop into one other than its bare id, or a string
 * `virtual` field that resolves through one.
 */
const reachesUnreadable = (
	scope: McpxToolScope,
	args: { collection: string; path: string; locale?: string | undefined },
	seen: Set<string> = new Set(),
): boolean => {
	const key = `${args.collection}:${args.path}`;
	const { payload } = scope.req;

	if (seen.has(key)) {
		return false;
	}

	seen.add(key);

	const hops = getLocalizedPaths({
		collectionSlug: args.collection,
		fields: payload.collections[args.collection]?.config.flattenedFields ?? [],
		incomingPath: args.path,
		...(args.locale ? { locale: args.locale } : {}),
		payload,
	});

	return hops.some((hop, index) => {
		const { collectionSlug, field } = hop;
		const via = hops[index - 1]?.field;
		const isBareId =
			hop.path === "id" &&
			(via?.type === "relationship" ||
				via?.type === "upload" ||
				via?.type === "join");

		if (
			index > 0 &&
			collectionSlug !== undefined &&
			!scope.collections.readable.includes(collectionSlug) &&
			!isBareId
		) {
			return true;
		}

		return (
			!hop.invalid &&
			"virtual" in field &&
			typeof field.virtual === "string" &&
			reachesUnreadable(
				scope,
				{
					collection: collectionSlug ?? args.collection,
					path: normalise(field.virtual),
					locale: args.locale,
				},
				seen,
			)
		);
	});
};

/**
 * Refuses a `where` or `sort` that traverses a relationship, upload or join
 * field into a collection the key cannot read, since Payload answers it from
 * documents the key may not see. Naming the relation field itself, or its id,
 * stays allowed, as does traversal into a readable collection. Unknown paths
 * are left to Payload.
 */
export const assertQueryable = (
	scope: McpxToolScope,
	args: {
		collection: string;
		where?: unknown;
		sort?: string | undefined;
		locale?: string | null | undefined;
	},
): void => {
	const reaches = (path: string): boolean =>
		reachesUnreadable(scope, {
			collection: args.collection,
			path: normalise(path),
			locale: args.locale ?? undefined,
		});

	for (const path of wherePaths(args.where)) {
		if (reaches(path)) {
			throw new APIError(`This key cannot query through "${path}".`, 400);
		}
	}

	for (const path of sortPaths(args.sort)) {
		/*
		 * Payload's sort sanitising swaps in a string virtual it meets while walking
		 * the segments, so each segment is also checked as a root-level path.
		 */
		if (reaches(path) || normalise(path).split(".").some(reaches)) {
			throw new APIError(`This key cannot query through "${path}".`, 400);
		}
	}
};
