import { authenticateAs } from "./handler.js";
import { runTool } from "./server.js";
import { checkApiKey } from "../auth/resolve.js";
import { isToolEnabled, toolInputSchema } from "../define-tool.js";
import { claimGrant, grantKvSlug } from "../grants/grant.js";
import { BUILTIN_TOOLS } from "../tools/builtin.js";
import {
	downloadSlugs,
	setUploadedFile,
	uploadMaxBytes,
} from "../upload/file.js";

import type { ApiKeyDoc } from "../auth/resolve.js";
import type { Grant } from "../grants/grant.js";
import type { NormalizedOptions } from "../options.js";
import type { McpxToolExtra, McpxToolScope } from "../types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { PayloadHandler, PayloadRequest } from "payload";

const UPLOAD_TOOLS = new Set(["createDocument", "patchDocument"]);

const respond = (status: number, body: unknown): Response =>
	Response.json(body, { status });

/*
 * One answer for every grant that cannot be used, so a caller learns nothing
 * about which check failed.
 */
const refused = (): Response =>
	respond(403, {
		error:
			"The request was refused: the grant is unknown, expired or used, or the key no longer allows it. Call the tool again for a new one.",
	});

/*
 * The body, or `null` once it differs from `size`. A declared length is
 * checked unread. A chunked body is read until it passes `size`.
 */
const readExactly = async (
	req: PayloadRequest,
	size: number,
): Promise<Buffer | null> => {
	const declared = req.headers.get("content-length");

	if (declared !== null && Number(declared) !== size) {
		return null;
	}

	if (!req.body) {
		return null;
	}

	const chunks: Uint8Array[] = [];
	let total = 0;

	// Returning from inside the loop cancels the stream.
	for await (const chunk of req.body) {
		total += chunk.byteLength;

		if (total > size) {
			return null;
		}

		chunks.push(chunk);
	}

	return total === size ? Buffer.concat(chunks) : null;
};

// What the tool result's status means over HTTP.
const statusOf = (result: CallToolResult, data: Record<string, unknown>) => {
	if (result.isError !== true) {
		return 200;
	}

	if ("updatedAt" in data || data["status"] === 423) {
		return 409;
	}

	if (data["status"] === 401 || data["status"] === 403) {
		return 403;
	}

	return data["error"] === "Internal error" ? 500 : 422;
};

const parseResult = (result: CallToolResult): Record<string, unknown> => {
	const [first] = result.content;

	return first?.type === "text"
		? (JSON.parse(first.text) as Record<string, unknown>)
		: {};
};

// The upload runs outside an MCP session, so there is nothing to notify.
const NO_SESSION = {
	signal: new AbortController().signal,
	requestId: "upload",
	sendNotification: () => Promise.resolve(),
	sendRequest: () => Promise.reject(new Error("No MCP session.")),
} as unknown as McpxToolExtra;

const reauthenticate = async (
	req: PayloadRequest,
	options: NormalizedOptions,
	grant: Grant,
) => {
	const keyDoc = (await req.payload.findByID({
		collection: options.apiKeysSlug,
		id: grant.apiKeyId,
		depth: 0,
		overrideAccess: true,
		disableErrors: true,
		select: { enabled: true, user: true, capabilities: true, expiresAt: true },
	})) as ApiKeyDoc | null;

	return await checkApiKey(req, options, keyDoc ?? undefined);
};

/*
 * Claims the grant in `x-mcpx-grant` and makes `req` act as its key again, or
 * returns `undefined`. Only the grant steers the request, so the query is
 * dropped and the locale is the one of the tool call: `?uploadEdits` would
 * crop or move the focal point, `?locale` would change where a write lands
 * and `?prefix` which file is served.
 */
const claimAs = async <Kind extends Grant["kind"]>(
	req: PayloadRequest,
	options: NormalizedOptions,
	kind: Kind,
): Promise<
	{ grant: Extract<Grant, { kind: Kind }>; scope: McpxToolScope } | undefined
> => {
	const slug = grantKvSlug(req.payload.config);
	const grantId = req.headers.get("x-mcpx-grant");

	if (slug === undefined || options.auth?.resolve || grantId === null) {
		return undefined;
	}

	const grant = await claimGrant(req.payload, slug, grantId);

	if (grant?.kind !== kind) {
		return undefined;
	}

	const auth = await reauthenticate(req, options, grant);

	if (!auth) {
		return undefined;
	}

	const scope = authenticateAs(req, options, auth);

	req.query = {};

	for (const name of [...req.searchParams.keys()]) {
		req.searchParams.delete(name);
	}

	req.locale = grant.locale;
	req.fallbackLocale = grant.fallbackLocale as Exclude<
		PayloadRequest["fallbackLocale"],
		undefined
	>;

	return { grant: grant as Extract<Grant, { kind: Kind }>, scope };
};

/**
 * Completes a call that returned an `upload`: claims the grant, acts as its
 * key again, then runs the same tool with the same arguments and the body as
 * the file. The response body is the tool's result. The grant header is never
 * logged.
 */
export const createUploadHandler =
	(options: NormalizedOptions): PayloadHandler =>
	async (req) => {
		const { payload } = req;
		const claimed = await claimAs(req, options, "upload");
		const file = claimed?.grant.args["file"] as
			undefined | { filename: string; mimeType: string; size: number };

		if (!claimed || !UPLOAD_TOOLS.has(claimed.grant.tool) || !file) {
			return refused();
		}

		const { grant, scope } = claimed;
		const tool = BUILTIN_TOOLS.find(
			(candidate) => candidate.name === grant.tool,
		);

		if (!tool || !isToolEnabled(tool, scope)) {
			return refused();
		}

		const args = toolInputSchema(tool, scope).safeParse(grant.args);

		if (!args.success) {
			return refused();
		}

		if (file.size > uploadMaxBytes(payload.config)) {
			return respond(413, { error: "The file is larger than allowed." });
		}

		const data = await readExactly(req, file.size);

		if (data === null) {
			return respond(400, {
				error: `The body must be exactly ${String(file.size)} bytes, the size the tool call declared.`,
			});
		}

		// The declared type, not the request's, so Payload checks what was granted.
		setUploadedFile(req, {
			data,
			mimetype: file.mimeType,
			name: file.filename,
			size: data.length,
		});

		const result = await runTool(tool, args.data, scope, req, NO_SESSION);
		const body = parseResult(result);

		return respond(statusOf(result, body), body);
	};

/**
 * Serves the file of a `getDocument` call that returned a `download`: claims
 * the grant, acts as its key again, reloads the document as its user and
 * hands the request to the collection's own `/file/:filename` endpoint, so
 * Payload's file access, storage handlers and response headers apply.
 */
export const createDownloadHandler =
	(options: NormalizedOptions): PayloadHandler =>
	async (req) => {
		const claimed = await claimAs(req, options, "download");

		if (
			!claimed ||
			!downloadSlugs(claimed.scope).includes(claimed.grant.collection)
		) {
			return refused();
		}

		const { collection, id, draft } = claimed.grant;
		const doc = (await req.payload.findByID({
			collection,
			id,
			depth: 0,
			draft,
			overrideAccess: false,
			disableErrors: true,
			select: { filename: true, prefix: true },
			req,
		})) as null | { filename?: unknown; prefix?: unknown };
		const { endpoints } = req.payload.collections[collection]?.config ?? {};
		const endpoint = Array.isArray(endpoints)
			? endpoints.find(
					(candidate) =>
						candidate.method === "get" && candidate.path === "/file/:filename",
				)
			: undefined;

		if (typeof doc?.filename !== "string" || !endpoint) {
			return refused();
		}

		// From the document, so the server picks the stored file's prefix.
		if (typeof doc.prefix === "string") {
			req.searchParams.set("prefix", doc.prefix);
		}

		req.routeParams = { collection, filename: doc.filename };

		return await endpoint.handler(req);
	};
