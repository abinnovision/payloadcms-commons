import { FACTORY_USER_COLLECTION } from "./factory.js";
import { invalid } from "../options.js";

import type { StartupLogger } from "../options.js";
import type {
	CollectionBeforeChangeHook,
	CollectionConfig,
	DefaultDocumentIDType,
	PayloadRequest,
} from "payload";

/** The field the plugin adds to the files collection: the thread a file belongs to. */
export const FILE_THREAD_FIELD = "flueThread";

/** A file row as the plugin reads it. */
export interface FileDoc {
	id: DefaultDocumentIDType;
	/** The uploader's file name, where the collection keeps one apart from `filename`. */
	name?: unknown;
	filename?: null | string;
	mimeType?: null | string;
	filesize?: null | number;
	prefix?: null | string;
}

/**
 * Hands `req` to the collection's own `/file/:filename` endpoint for the
 * stored file of `doc`, so Payload's file access, storage handlers, Range
 * support and headers apply. The query parameters that pick another file
 * are dropped; the prefix comes from the document. `undefined` when the
 * document has no stored file.
 */
export const serveFile = async (
	req: PayloadRequest,
	slug: string,
	doc: Pick<FileDoc, "filename" | "prefix">,
): Promise<Response | undefined> => {
	const { endpoints } = req.payload.collections[slug]?.config ?? {};
	const endpoint = Array.isArray(endpoints)
		? endpoints.find(
				(candidate) =>
					candidate.method === "get" && candidate.path === "/file/:filename",
			)
		: undefined;

	if (typeof doc.filename !== "string" || !endpoint) {
		return undefined;
	}

	for (const name of ["prefix", "version", "original"]) {
		req.searchParams.delete(name);
	}

	if (typeof doc.prefix === "string") {
		req.searchParams.set("prefix", doc.prefix);
	}

	req.routeParams = { collection: slug, filename: doc.filename };

	return await endpoint.handler(req);
};

interface FilesCollectionView {
	slug: string;
	upload?: unknown;
	authorship?: unknown;
	custom?: Record<string, unknown> | undefined;
	fields: readonly unknown[];
}

const hasField = (fields: readonly unknown[], name: string): boolean =>
	fields.some(
		(field) =>
			typeof field === "object" &&
			field !== null &&
			"name" in field &&
			field.name === name,
	);

/**
 * Refuses a files collection that is no upload collection, drops
 * `upload.mimeTypes`, which makes Payload check each file's content, drops
 * `createdBy`, which binding a file to a thread relies on, has a top-level
 * `download` field, which keeps mcpx from serving its files, or was built by
 * `fluePrivateUploads` for another user collection. Warns when files may
 * come from a URL.
 */
export const assertFilesCollection = (
	collection: FilesCollectionView,
	userCollection: string,
	logger: Pick<StartupLogger, "warn">,
): void => {
	const name = `The files collection "${collection.slug}"`;
	const upload = collection.upload as
		undefined | { mimeTypes?: unknown; pasteURL?: unknown };
	const authorship = collection.authorship as
		boolean | undefined | { createdBy?: unknown };
	const factoryUsers = collection.custom?.[FACTORY_USER_COLLECTION];

	if (typeof upload !== "object") {
		throw invalid(`${name} must be an upload collection (files.collection).`);
	}

	if (!Array.isArray(upload.mimeTypes) || upload.mimeTypes.length === 0) {
		throw invalid(
			`${name} must set upload.mimeTypes, which makes Payload check each file's content and the chat's picker offer them (files.collection).`,
		);
	}

	if (
		authorship === false ||
		(typeof authorship === "object" && authorship.createdBy === false)
	) {
		throw invalid(
			`${name} must keep authorship.createdBy: a user sends only files they uploaded.`,
		);
	}

	if (hasField(collection.fields, "download")) {
		throw invalid(
			`${name} must not have a top-level field named "download": mcpx serves no files of such a collection.`,
		);
	}

	if (factoryUsers !== undefined && factoryUsers !== userCollection) {
		throw invalid(
			`${name} was built for users of ${JSON.stringify(factoryUsers)}, but mcpx's user collection is "${userCollection}". Pass userCollection to fluePrivateUploads.`,
		);
	}

	if (upload.pasteURL !== false) {
		logger.warn(
			`[payloadcms-flue] ${name} allows uploads from a URL. Set upload.pasteURL: false unless users should paste URLs.`,
		);
	}
};

/**
 * The files collection with the server-only `flueThread` field and `hook`
 * added. Refuses a collection that already has a field of that name.
 */
export const withThreadField = (
	collection: CollectionConfig,
	threadsSlug: string,
	hook: CollectionBeforeChangeHook,
): CollectionConfig => {
	if (hasField(collection.fields, FILE_THREAD_FIELD)) {
		throw invalid(
			`The files collection "${collection.slug}" already has a field named "${FILE_THREAD_FIELD}", which the plugin adds.`,
		);
	}

	return {
		...collection,
		hooks: {
			...collection.hooks,
			beforeChange: [...(collection.hooks?.beforeChange ?? []), hook],
		},
		fields: [
			...collection.fields,
			{
				name: FILE_THREAD_FIELD,
				type: "relationship",
				relationTo: threadsSlug,
				index: true,
				// Written by the plugin only, which bypasses access control.
				access: { create: () => false, update: () => false },
				admin: { readOnly: true, position: "sidebar" },
			},
		],
	};
};

interface SanitizedField {
	name?: string;
	type?: string;
	relationTo?: unknown;
	access?: Record<string, unknown>;
}

// Whether a field's access function refuses `operation` to a request without a user.
const refuses = async (
	field: SanitizedField | undefined,
	operation: "create" | "update",
): Promise<boolean> => {
	const access = field?.access?.[operation];

	return (
		typeof access === "function" &&
		(await (access as (args: object) => unknown)({ req: {} })) === false
	);
};

/**
 * Refuses a started files collection whose `createdBy` is not Payload's
 * authorship field for `userCollection`, which only the server stamps, or
 * whose `flueThread` field is no longer writable by the server only.
 */
export const assertStartedFilesCollection = async (
	collection: {
		slug: string;
		authorship?: { createdBy?: boolean };
		flattenedFields: readonly SanitizedField[];
	},
	userCollection: string,
): Promise<void> => {
	const name = `The files collection "${collection.slug}"`;
	const field = (fieldName: string) =>
		collection.flattenedFields.find((entry) => entry.name === fieldName);
	const createdBy = field("createdBy");
	const relationTo = createdBy?.relationTo;

	if (
		collection.authorship?.createdBy !== true ||
		createdBy?.type !== "relationship" ||
		!(Array.isArray(relationTo) ? relationTo : [relationTo]).includes(
			userCollection,
		) ||
		!(await refuses(createdBy, "create")) ||
		!(await refuses(createdBy, "update"))
	) {
		throw invalid(
			`${name} must keep Payload's authorship createdBy for "${userCollection}", which only the server writes.`,
		);
	}

	const thread = field(FILE_THREAD_FIELD);

	if (
		thread?.type !== "relationship" ||
		!(await refuses(thread, "create")) ||
		!(await refuses(thread, "update"))
	) {
		throw invalid(
			`${name} must keep the "${FILE_THREAD_FIELD}" field the plugin adds, writable by the server only.`,
		);
	}
};
