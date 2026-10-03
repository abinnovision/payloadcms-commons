import {
	createDataloaderCacheKey,
	getDataLoader,
	isolateObjectProperty,
} from "payload";

import type { McpxToolScope } from "../types.js";
import type { PayloadRequest, TypeWithID } from "payload";

/*
 * Positions of the collection slug and document id in the data loader's cache
 * key, found by probing rather than assumed. If the layout cannot be read both
 * are -1, which refuses every population.
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
 * A read request that populates only into collections this key may read, at
 * every depth, through a data loader of its own. A refused relation resolves to
 * its id. Each call returns a fresh request.
 */
export const mcpxReadRequest = (scope: McpxToolScope): PayloadRequest => {
	const req = isolateObjectProperty(scope.req, "payloadDataLoader");
	const loader = getDataLoader(req);
	const load = loader.load.bind(loader);

	loader.load = (key) => {
		const parts = JSON.parse(key) as unknown[];
		const collection = parts[LOADER_KEY.slug];

		return typeof collection === "string" &&
			scope.collections.readable.includes(collection)
			? load(key)
			: Promise.resolve(parts[LOADER_KEY.id] as TypeWithID);
	};

	req.payloadDataLoader = loader;

	return req;
};
