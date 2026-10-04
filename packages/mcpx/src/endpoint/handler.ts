import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { isValidAuthResult, resolveApiKeyAuth } from "../auth/resolve.js";
import { resolveCapabilities, scopeSlugs } from "../capabilities.js";
import { jsonRpcError } from "./errors.js";
import { createMcpServer } from "./server.js";
import { grantKvSlug } from "../grants/grant.js";

import type { NormalizedOptions } from "../options.js";
import type { McpxAuthResult, McpxToolScope } from "../types.js";
import type { PayloadHandler, PayloadRequest } from "payload";

const BODY_BYTES_LIMIT = 4 * 1024 * 1024;

const BATCH_MESSAGES_LIMIT = 10;

/*
 * The body as text, `null` once it passes {@link BODY_BYTES_LIMIT}, or
 * `undefined` when there is none. A declared length over the limit is refused
 * unread. A chunked body declares none, so bytes are counted as they arrive and
 * reading stops at the limit.
 */
const readBody = async (
	req: PayloadRequest,
): Promise<string | null | undefined> => {
	if (Number(req.headers.get("content-length")) > BODY_BYTES_LIMIT) {
		return null;
	}

	if (!req.body) {
		return undefined;
	}

	const decoder = new TextDecoder();
	let text = "";
	let size = 0;

	// Returning from inside the loop cancels the stream.
	for await (const chunk of req.body) {
		size += chunk.byteLength;

		if (size > BODY_BYTES_LIMIT) {
			return null;
		}

		text += decoder.decode(chunk, { stream: true });
	}

	return text + decoder.decode();
};

/**
 * The scope the tools of one request see: the key's resolved capabilities, the
 * slugs they reach, and the locales and limits of the config.
 */
export const buildScope = (
	req: PayloadRequest,
	options: NormalizedOptions,
	capabilities: McpxToolScope["capabilities"],
): McpxToolScope => {
	const { localization } = req.payload.config;

	return {
		req,
		capabilities,
		collections: scopeSlugs(capabilities.collections),
		globals: scopeSlugs(capabilities.globals),
		localization: localization
			? {
					locales: localization.localeCodes,
					defaultLocale: localization.defaultLocale,
				}
			: null,
		limits: options.limits,
		/*
		 * A custom resolver may authenticate by more than the key, which the
		 * upload endpoint cannot replay, so it turns uploads off.
		 */
		uploads:
			options.auth?.resolve === undefined &&
			grantKvSlug(req.payload.config) !== undefined,
		diagnostics: options.diagnostics
			? { name: options.serverInfo.name, version: options.serverInfo.version }
			: null,
		exposure: { collections: options.collections, globals: options.globals },
	};
};

/**
 * Makes `req` act as the key: sets `req.user`, replacing any user Payload
 * resolved from cookies, and the `req.context.mcpx` stamp the draft guard
 * reads. Returns the scope the tools see.
 */
export const authenticateAs = (
	req: PayloadRequest,
	options: NormalizedOptions,
	auth: McpxAuthResult,
): McpxToolScope => {
	const capabilities = resolveCapabilities(options, auth.capabilities);

	req.user = auth.user;
	req.context = {
		...req.context,
		mcpx: { apiKeyId: auth.apiKeyId, capabilities },
	};

	return buildScope(req, options, capabilities);
};

/**
 * Answers GET and DELETE on the endpoint path. The server is stateless and
 * never streams, so only POST carries meaning.
 */
export const methodNotAllowed: PayloadHandler = () =>
	jsonRpcError({
		status: 405,
		code: -32000,
		message: "Method not allowed. MCP requests must use POST.",
		headers: { allow: "POST" },
	});

/**
 * The MCP endpoint. Authenticates the bearer key, sets `req.user` and the
 * request marker, then serves the JSON-RPC body with a fresh server and
 * transport. Any user Payload resolved from cookies or a JWT is ignored: only
 * an API key authenticates here.
 */
export const createMcpxHandler =
	(options: NormalizedOptions): PayloadHandler =>
	async (req) => {
		const resolveDefault = (): ReturnType<typeof resolveApiKeyAuth> =>
			resolveApiKeyAuth(req, options);

		// Typed as unknown because a custom resolver's result is not trusted.
		const auth: unknown = options.auth?.resolve
			? await options.auth.resolve({ req, resolveDefault })
			: await resolveDefault();

		if (!isValidAuthResult(auth, options)) {
			if (auth) {
				req.payload.logger.error(
					"[payloadcms-mcpx] auth.resolve returned an invalid result: it needs a user of the user collection with an id, and an apiKeyId.",
				);
			}

			return jsonRpcError({
				status: 401,
				code: -32001,
				message: "Unauthorized: a valid API key is required.",
				headers: { "www-authenticate": "Bearer" },
			});
		}

		const scope = authenticateAs(req, options, auth);

		let parsedBody: unknown;
		try {
			const text = await readBody(req);

			if (text === null) {
				return jsonRpcError({
					status: 413,
					code: -32000,
					message: `Request body too large: the limit is ${String(BODY_BYTES_LIMIT / 1024 / 1024)} MB.`,
				});
			}

			parsedBody = text === undefined ? undefined : JSON.parse(text);
		} catch {
			return jsonRpcError({
				status: 400,
				code: -32700,
				message: "Parse error: Invalid JSON",
			});
		}

		if (parsedBody === undefined || req.url === undefined) {
			return jsonRpcError({
				status: 400,
				code: -32600,
				message: "Invalid request: a JSON body is required.",
			});
		}

		if (Array.isArray(parsedBody) && parsedBody.length > BATCH_MESSAGES_LIMIT) {
			return jsonRpcError({
				status: 400,
				code: -32600,
				message: `Invalid request: a batch may hold at most ${String(BATCH_MESSAGES_LIMIT)} messages.`,
			});
		}

		const server = createMcpServer(scope, options);

		// No session id generator means stateless: one transport per request.
		const transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
		});

		await server.connect(transport);

		/*
		 * The transport insists on both media types in Accept; every answer is
		 * JSON anyway, so the header is normalized rather than enforced.
		 */
		const headers = new Headers(req.headers);

		headers.set("accept", "application/json, text/event-stream");

		try {
			return await transport.handleRequest(
				new Request(req.url, { method: "POST", headers }),
				{ parsedBody },
			);
		} finally {
			await server.close();
		}
	};
