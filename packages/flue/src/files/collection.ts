import { randomUUID } from "node:crypto";
import { APIError } from "payload";

import { invalid } from "../options.js";
import { FILE_LIMITS } from "../protocol/files.js";
import { ownerWhere } from "../threads/owner.js";

import type { NormalizedFiles, NormalizedOptions } from "../options.js";
import type {
	CollectionBeforeOperationHook,
	CollectionConfig,
	DefaultDocumentIDType,
	Payload,
	PayloadRequest,
	Where,
} from "payload";

/** The plugin settings the file workspace reads, with the workspace on. */
export type FilesSettings = Pick<
	NormalizedOptions,
	"agents" | "mcpx" | "threads"
> & { files: NormalizedFiles };

/** A workspace file row as the plugin reads it. */
export interface FileDoc {
	id: DefaultDocumentIDType;
	name?: null | string;
	filename?: null | string;
	mimeType?: null | string;
	filesize?: null | number;
	prefix?: null | string;
	createdAt?: string;
}

// Written by the plugin only, which bypasses access control.
const SERVER_ONLY = { create: () => false, update: () => false };

const NAME_MAX = 255;

// An extension Payload can still tell a text file's type from.
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

const refuse = (message: string, status: number): APIError =>
	new APIError(message, status, null, true);

/**
 * The files of `req.user` that no turn has claimed yet, or `false` outside
 * the mcpx user collection.
 */
export const pendingWhere = (
	req: PayloadRequest,
	userCollection: string,
): false | Where => {
	const owned = ownerWhere(req, userCollection);

	return owned && { and: [owned, { thread: { exists: false } }] };
};

/**
 * Deletes the pending files of `req.user` older than the pending TTL, as the
 * user. Logs how many it removed.
 */
export const sweepPending = async (
	req: PayloadRequest,
	settings: FilesSettings,
): Promise<void> => {
	const pending = pendingWhere(req, settings.mcpx.userCollection);

	if (!pending) {
		return;
	}

	const cutoff = new Date(Date.now() - FILE_LIMITS.pending.ttlMs);
	const { docs } = await req.payload.delete({
		collection: settings.files.slug,
		where: {
			and: [pending, { createdAt: { less_than: cutoff.toISOString() } }],
		},
		depth: 0,
		overrideAccess: false,
		req,
	});

	if (docs.length > 0) {
		req.payload.logger.info(
			`[payloadcms-flue] Removed ${String(docs.length)} stale pending files.`,
		);
	}
};

/**
 * Deletes the files of a thread on a request of its own, so it runs in its
 * own transaction. Best effort: a failure is logged, never thrown, so
 * archiving goes on.
 */
export const deleteThreadFiles = async (
	payload: Payload,
	settings: Pick<NormalizedOptions, "files">,
	thread: DefaultDocumentIDType,
): Promise<void> => {
	if (!settings.files) {
		return;
	}

	const msg = "[payloadcms-flue] Could not delete the files of a thread.";

	try {
		const { errors } = await payload.delete({
			collection: settings.files.slug,
			where: { thread: { equals: thread } },
			depth: 0,
			overrideAccess: true,
		});

		if (errors.length > 0) {
			payload.logger.error({
				msg,
				files: errors.map((error) => error.id),
			});
		}
	} catch (error) {
		payload.logger.error({ err: error, msg });
	}
};

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

/*
 * Checks an upload before Payload stores it: its declared type and size,
 * and the user's pending caps after removing their stale pending files. The
 * stored name is random, so the collection-wide unique filename reveals
 * nothing about other users' files; the uploader's name goes in `name`.
 */
const prepareUpload =
	(settings: FilesSettings): CollectionBeforeOperationHook =>
	async (hook) => {
		const { req } = hook;
		const { file } = req;

		/*
		 * The argument union carries a deprecated `read` member, which is what
		 * the deprecation rule reacts to; the operation name is current API.
		 */
		// eslint-disable-next-line @typescript-eslint/no-deprecated
		if (hook.operation !== "create") {
			return hook.args;
		}

		// A create without a multipart file would let Payload fetch a `url` from the body.
		if (!file) {
			throw refuse("The request must carry the file.", 400);
		}

		const { files } = settings;

		if (!(files.mimeTypes as string[]).includes(file.mimetype)) {
			throw refuse(
				`The file type must be one of ${files.mimeTypes.join(", ")}.`,
				400,
			);
		}

		if (file.size > files.maxBytes) {
			throw refuse(
				`The file is larger than ${String(files.maxBytes)} bytes.`,
				413,
			);
		}

		const pending = pendingWhere(req, settings.mcpx.userCollection);

		if (pending) {
			await sweepPending(req, settings);

			const { docs } = await req.payload.find({
				collection: files.slug,
				where: pending,
				depth: 0,
				pagination: false,
				overrideAccess: true,
				select: { filesize: true },
				req,
			});
			const bytes = docs.reduce(
				(sum, doc) => sum + (Number(doc["filesize"]) || 0),
				file.size,
			);

			if (docs.length >= FILE_LIMITS.pending.files) {
				throw refuse(
					`At most ${String(FILE_LIMITS.pending.files)} files may wait for a message. Send or remove some first.`,
					400,
				);
			}

			if (bytes > FILE_LIMITS.pending.bytes) {
				throw refuse(
					`The files waiting for a message may hold at most ${String(FILE_LIMITS.pending.bytes)} bytes together. Send or remove some first.`,
					400,
				);
			}
		}

		const extension = EXTENSION.exec(file.name)?.[0].toLowerCase() ?? "";

		req.file = { ...file, name: `${randomUUID()}${extension}` };

		return {
			...hook.args,
			data: { ...hook.args.data, name: file.name.slice(0, NAME_MAX) },
		};
	};

/**
 * Refuses a files collection whose upload config drops `mimeTypes`, which
 * makes Payload check each file's content, turns off Payload's access
 * control for file reads, which leaves a file readable by anyone, or allows
 * uploads from a URL, which Payload fetches past the plugin's checks.
 */
export const assertFilesCollection = (collection: {
	slug: string;
	upload?: unknown;
}): void => {
	const upload = collection.upload as
		| undefined
		| {
				disablePayloadAccessControl?: unknown;
				mimeTypes?: unknown;
				pasteURL?: unknown;
		  };

	if (
		typeof upload !== "object" ||
		!Array.isArray(upload.mimeTypes) ||
		upload.mimeTypes.length === 0
	) {
		throw invalid(
			`The files collection "${collection.slug}" must keep upload.mimeTypes, which makes Payload check each file's content.`,
		);
	}

	if (upload.disablePayloadAccessControl === true) {
		throw invalid(
			`The files collection "${collection.slug}" must not set disablePayloadAccessControl: its files are readable by their owner only.`,
		);
	}

	if (upload.pasteURL !== false) {
		throw invalid(
			`The files collection "${collection.slug}" must keep upload.pasteURL: false, so every file goes through the plugin's upload checks.`,
		);
	}
};

/**
 * The `flue-files` upload collection. A user uploads files before a turn;
 * the turn claims them for its thread. Only the owner reads a file and only
 * while it is pending may they delete it. Nobody updates one through the API.
 */
export const createFilesCollection = (
	settings: FilesSettings,
): CollectionConfig => {
	const { userCollection } = settings.mcpx;

	return {
		slug: settings.files.slug,
		versions: false,
		// The owner is `createdBy`, compared by collection and id.
		authorship: true,
		admin: { hidden: true, useAsTitle: "name" },
		upload: {
			mimeTypes: settings.files.mimeTypes,
			filesRequiredOnCreate: true,
			pasteURL: false,
			crop: false,
			focalPoint: false,
		},
		access: {
			read: ({ req }) => ownerWhere(req, userCollection),
			create: async ({ req }) => {
				if (req.user?.collection !== userCollection) {
					return false;
				}

				for (const agent of settings.agents) {
					// eslint-disable-next-line no-await-in-loop
					if (!agent.access || (await agent.access({ req }))) {
						return true;
					}
				}

				return false;
			},
			update: () => false,
			delete: ({ req }) => pendingWhere(req, userCollection),
		},
		hooks: { beforeOperation: [prepareUpload(settings)] },
		fields: [
			{ name: "name", type: "text", required: true, maxLength: NAME_MAX },
			{
				name: "thread",
				type: "relationship",
				relationTo: settings.threads.slug,
				index: true,
				access: SERVER_ONLY,
			},
		],
	};
};
