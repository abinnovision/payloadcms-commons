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
 * The request a read tool hands to Payload, populating relations only into
 * collections this key may read. Relationships, uploads, joins and rich text
 * all populate through `req.payloadDataLoader`, so a loader of its own on an
 * isolated request bounds every depth without touching the request custom
 * tools share. A refused relation resolves to its own id, as at depth 0: rich
 * text would set `null` if the loader answered nothing.
 */
export const readRequest = (scope: McpxToolScope): PayloadRequest => {
	const req = isolateObjectProperty(scope.req, "payloadDataLoader");
	const loader = getDataLoader(req);
	const load = loader.load.bind(loader);

	loader.load = (key) => {
		const parts = JSON.parse(key) as unknown[];
		const collection = parts[LOADER_KEY.slug];

		return typeof collection === "string" && scope.readable.includes(collection)
			? load(key)
			: Promise.resolve(parts[LOADER_KEY.id] as TypeWithID);
	};

	req.payloadDataLoader = loader;

	return req;
};
