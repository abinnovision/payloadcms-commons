import { APIError } from "payload";

import { handleNotFound, resolveHandle } from "./handle.js";
import {
	endpointHandler,
	isDocumentId,
	json,
	readJson,
	refusal,
	requireJson,
	secretMatches,
} from "./http.js";
import { serveFile } from "../files/collection.js";
import {
	FILE_AGENT_HEADER,
	FILE_HANDLE_HEADER,
	FILE_LIMITS,
} from "../protocol/files.js";
import { isRecord } from "../protocol/guards.js";

import type { ResolvedHandle } from "./handle.js";
import type { FileDoc } from "../files/collection.js";
import type { NormalizedFiles } from "../options.js";
import type { WorkspaceFile } from "../protocol/files.js";
import type { PluginSettings } from "../turn.js";
import type { PayloadHandler, PayloadRequest } from "payload";

const BODY_MAX = 4 * 1024;

/** The plugin settings with the file workspace on. */
export type FilesPluginSettings = PluginSettings & { files: NormalizedFiles };

/*
 * Makes `req` act as the thread's user, loaded as mcpx loads a key's user,
 * so the files collection's access control applies to the owner. `false`
 * when the user no longer exists.
 */
const actAsOwner = async (
	req: PayloadRequest,
	{ user }: ResolvedHandle,
): Promise<boolean> => {
	const { payload } = req;
	const doc = await payload.findByID({
		collection: user.collection,
		id: user.id,
		depth: payload.collections[user.collection]?.config.auth.depth ?? 0,
		overrideAccess: true,
		disableErrors: true,
	});

	if (!doc) {
		return false;
	}

	req.user = { ...doc, collection: user.collection };

	return true;
};

/**
 * `POST {base}/files/list`: the workspace files of a live handle's thread,
 * oldest first, read as the thread's user. Only the sidecar calls it,
 * authenticated by the shared secret. Reactive and ambient threads have no
 * files.
 */
export const filesListHandler = (
	settings: FilesPluginSettings,
): PayloadHandler =>
	endpointHandler(async (req) => {
		if (
			!secretMatches(req.headers.get("authorization"), settings.sidecar.secret)
		) {
			return refusal(401, "The sidecar secret does not match.");
		}

		const notJson = requireJson(req);

		if (notJson) {
			return notJson;
		}

		const body = await readJson(req, BODY_MAX);

		if (body instanceof Response) {
			return body;
		}

		if (
			!isRecord(body) ||
			typeof body["handle"] !== "string" ||
			body["handle"] === "" ||
			typeof body["agent"] !== "string"
		) {
			return refusal(400, "The body must carry a handle and an agent.");
		}

		const resolved = await resolveHandle(
			req,
			settings,
			body["handle"],
			body["agent"],
		);

		if (!resolved) {
			return handleNotFound();
		}

		if (resolved.thread.kind !== "chat") {
			return json(200, []);
		}

		if (!(await actAsOwner(req, resolved))) {
			return handleNotFound();
		}

		const { docs } = await req.payload.find({
			collection: settings.files.slug,
			where: { thread: { equals: resolved.thread.id } },
			sort: ["createdAt", "id"],
			limit: FILE_LIMITS.listMax,
			depth: 0,
			overrideAccess: false,
			select: { name: true, mimeType: true, filesize: true, createdAt: true },
			req,
		});

		return json(
			200,
			(docs as FileDoc[]).map((doc): WorkspaceFile => ({
				id: doc.id,
				name: doc.name ?? "",
				mimeType: doc.mimeType ?? "",
				size: doc.filesize ?? 0,
				createdAt: doc.createdAt ?? "",
			})),
		);
	});

/**
 * `GET {base}/files/:file`: one workspace file of a live handle's thread,
 * served by the collection's own file endpoint as the thread's user, so a
 * `Range` header is honoured. The handle and the agent come in headers,
 * which keeps the handle out of URLs and logs.
 */
export const fileHandler = (settings: FilesPluginSettings): PayloadHandler =>
	endpointHandler(async (req) => {
		if (
			!secretMatches(req.headers.get("authorization"), settings.sidecar.secret)
		) {
			return refusal(401, "The sidecar secret does not match.");
		}

		const handle = req.headers.get(FILE_HANDLE_HEADER);
		const agent = req.headers.get(FILE_AGENT_HEADER);

		if (!handle || !agent) {
			return refusal(
				400,
				`The request must carry the ${FILE_HANDLE_HEADER} and ${FILE_AGENT_HEADER} headers.`,
			);
		}

		const resolved = await resolveHandle(req, settings, handle, agent);
		const id = req.routeParams?.["file"];

		if (
			!resolved ||
			!isDocumentId(req, id) ||
			!(await actAsOwner(req, resolved))
		) {
			return handleNotFound();
		}

		const { docs } = await req.payload.find({
			collection: settings.files.slug,
			where: {
				and: [
					{ id: { equals: id } },
					{ thread: { equals: resolved.thread.id } },
				],
			},
			limit: 1,
			pagination: false,
			depth: 0,
			overrideAccess: false,
			select: { filename: true, prefix: true },
			req,
		});
		const doc = docs[0] as FileDoc | undefined;
		let response: Response | undefined;

		try {
			response = doc && (await serveFile(req, settings.files.slug, doc));
		} catch (error) {
			if (error instanceof APIError) {
				return handleNotFound();
			}

			throw error;
		}

		// Any other answer gets the same 404 as every refusal of a handle.
		if (!response || (!response.ok && response.status !== 416)) {
			await response?.body?.cancel().catch(() => undefined);

			return handleNotFound();
		}

		return response;
	});
