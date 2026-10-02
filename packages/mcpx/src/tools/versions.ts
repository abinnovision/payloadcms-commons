import { hasDraftsEnabled } from "payload/shared";
import { createPatch, Pointer } from "rfc6902";

import { readRequest } from "./read-request.js";

import type { DocumentId, DocumentRef } from "../entity.js";
import type { McpxToolScope } from "../types.js";
import type { PaginatedDocs, SelectType, TypedLocale, Where } from "payload";
import type { Operation } from "rfc6902";

// A stored version: its metadata plus the document body under `version`.
type StoredVersion = Record<string, unknown> & {
	id: DocumentId;
	version: Record<string, unknown>;
};

export interface VersionRead {
	/** For a collection, also the document every version must belong to. */
	target: DocumentRef;
	depth: number;
	locale: TypedLocale | undefined;
}

// Bookkeeping that differs between saves without saying anything about content.
const NOISE = ["id", "globalType", "createdAt", "updatedAt", "_status"];

// Newest first, with the id breaking ties between saves in the same instant.
const NEWEST_FIRST = ["-updatedAt", "-id"];

/** The document or global as the key's user sees it. */
export const readLive = async (
	scope: McpxToolScope,
	read: VersionRead,
	options: { draft: boolean; select?: SelectType },
): Promise<Record<string, unknown>> => {
	const shared = {
		depth: read.depth,
		draft: options.draft,
		overrideAccess: false,
		req: readRequest(scope),
		...(options.select === undefined ? {} : { select: options.select }),
		...(read.locale === undefined ? {} : { locale: read.locale }),
	};

	return await (read.target.kind === "collection"
		? scope.req.payload.findByID({
				...shared,
				collection: read.target.slug,
				id: read.target.id,
			})
		: scope.req.payload.findGlobal({ ...shared, slug: read.target.slug }));
};

/*
 * Payload checks only `readVersions` on a version read, never `read`, so the
 * document itself is read first and throws when the key's user may not see it.
 */
const assertReadable = async (
	scope: McpxToolScope,
	read: VersionRead,
): Promise<void> => {
	await readLive(scope, { ...read, depth: 0 }, { draft: true, select: {} });
};

/** `parent` comes back as a raw id or, populated, as the document itself. */
export const isVersionOf = (
	version: Record<string, unknown>,
	id: DocumentId,
): boolean => {
	const parent = version["parent"];
	const parentId =
		typeof parent === "object" && parent !== null
			? (parent as Record<string, unknown>)["id"]
			: parent;

	return (
		(typeof parentId === "string" || typeof parentId === "number") &&
		String(parentId) === String(id)
	);
};

/**
 * Reads one version, or `null` when it does not exist, is not readable, or
 * belongs to another document. `findVersionByID` knows nothing of the document
 * the caller asked about, so the parent check is what keeps one readable
 * document from opening the history of another.
 */
export const loadVersion = async (
	scope: McpxToolScope,
	read: VersionRead,
	versionId: DocumentId,
): Promise<null | StoredVersion> => {
	await assertReadable(scope, read);

	const { payload } = scope.req;
	const shared = {
		id: versionId as string,
		depth: read.depth,
		disableErrors: true,
		overrideAccess: false,
		req: readRequest(scope),
		...(read.locale === undefined ? {} : { locale: read.locale }),
	};

	const version = (await (read.target.kind === "collection"
		? payload.findVersionByID({ ...shared, collection: read.target.slug })
		: payload.findGlobalVersionByID({
				...shared,
				slug: read.target.slug,
			}))) as null | StoredVersion;

	if (!version) {
		return null;
	}

	if (
		read.target.kind === "collection" &&
		!isVersionOf(version, read.target.id)
	) {
		return null;
	}

	return version;
};

/** One page of a document's or global's history, newest first. */
export const queryVersions = async (
	scope: McpxToolScope,
	read: VersionRead,
	options: { status?: "draft" | "published"; limit: number; page?: number },
): Promise<PaginatedDocs<StoredVersion>> => {
	await assertReadable(scope, read);

	const where: Where = {
		...(read.target.kind === "collection"
			? { parent: { equals: read.target.id } }
			: {}),
		...(options.status === undefined
			? {}
			: { "version._status": { equals: options.status } }),
	};
	const shared = {
		depth: read.depth,
		limit: options.limit,
		sort: NEWEST_FIRST,
		overrideAccess: false,
		req: readRequest(scope),
		where,
		...(options.page === undefined ? {} : { page: options.page }),
		...(read.locale === undefined ? {} : { locale: read.locale }),
	};

	return await (read.target.kind === "collection"
		? scope.req.payload.findVersions({
				...shared,
				collection: read.target.slug,
			})
		: scope.req.payload.findGlobalVersions({
				...shared,
				slug: read.target.slug,
			}));
};

/** The newest version whose status is published, or `null` if none is. */
export const loadPublished = async (
	scope: McpxToolScope,
	read: VersionRead,
): Promise<null | StoredVersion> => {
	// Without drafts no version has a status, and Payload refuses the query.
	if (!hasDraftsEnabled(read.target.config)) {
		return null;
	}

	const result = await queryVersions(scope, read, {
		status: "published",
		limit: 1,
	});

	return result.docs[0] ?? null;
};

const strip = (doc: Record<string, unknown>): Record<string, unknown> =>
	Object.fromEntries(
		Object.entries(doc).filter(([key]) => !NOISE.includes(key)),
	);

/**
 * The RFC 6902 operations turning `from` into `to`, limited to the subtree at
 * `pointer`. Op paths stay absolute, so they apply as `patchDocument` ops.
 */
export const diffDocuments = (
	from: Record<string, unknown>,
	to: Record<string, unknown>,
	pointer: Pointer = Pointer.fromJSON(""),
): Operation[] => {
	// Wrapped so a subtree missing on one side becomes an add or remove.
	const wrap = (doc: Record<string, unknown>): Record<string, unknown> => {
		const value = pointer.get(strip(doc)) as unknown;

		return value === undefined ? {} : { value };
	};

	const path = pointer.toString();

	return createPatch(wrap(from), wrap(to)).map((op) => ({
		...op,
		path: `${path}${op.path.slice("/value".length)}`,
	}));
};
