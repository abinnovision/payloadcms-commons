import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getAccessResults } from "payload";

import {
	authenticateRequest,
	isValidAuthResult,
	principalOf,
	resolveApiKeyAuth,
	resolveStrategyAuth,
} from "../auth/resolve.js";
import {
	narrowToPermissions,
	resolveCapabilities,
	scopeSlugs,
} from "../capabilities.js";
import { jsonRpcError } from "./errors.js";
import { leasesAvailable, readCapped } from "./http.js";
import { createMcpServer } from "./server.js";

import type { NormalizedOptions } from "../options.js";
import type {
	McpxAuthResult,
	McpxRequestContext,
	McpxToolScope,
} from "../types.js";
import type { PayloadHandler, PayloadRequest } from "payload";

const BODY_BYTES_LIMIT = 4 * 1024 * 1024;

const BATCH_MESSAGES_LIMIT = 10;

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
		uploads: leasesAvailable(req, options) !== undefined,
		diagnostics: options.diagnostics ? options.serverInfo : null,
		exposure: { collections: options.collections, globals: options.globals },
	};
};

/**
 * Makes `req` act as `user`: sets `req.user`, replacing any user Payload
 * resolved from cookies, and the `req.context.mcpx` stamp the draft guard
 * reads. Returns the scope the tools see.
 */
export const actAs = (
	req: PayloadRequest,
	options: NormalizedOptions,
	user: McpxAuthResult["user"],
	mcpx: McpxRequestContext,
): McpxToolScope => {
	req.user = user;
	req.context = { ...req.context, mcpx };

	return buildScope(req, options, mcpx.capabilities);
};

/**
 * Makes `req` act as the authenticated user, with the capabilities its key or
 * strategy resolves to, narrowed to the user's Payload permissions and bound
 * to its principal.
 */
export const authenticateAs = async (
	req: PayloadRequest,
	options: NormalizedOptions,
	auth: McpxAuthResult,
): Promise<McpxToolScope> => {
	req.user = auth.user;

	const permissions = await getAccessResults({ req });

	return actAs(req, options, auth.user, {
		...(auth.apiKeyId === undefined ? {} : { apiKeyId: auth.apiKeyId }),
		principal: principalOf(auth),
		capabilities: narrowToPermissions(
			resolveCapabilities(options, auth.capabilities),
			permissions,
		),
	});
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
 * The MCP endpoint. Authenticates the request, sets `req.user` and the
 * request marker, then serves the JSON-RPC body with a fresh server and
 * transport. The auth strategies run again without admin autologin, and only
 * auth a strategy attached or an API key authenticates here: a user from
 * cookies or a JWT alone is ignored.
 */
export const createMcpxHandler =
	(options: NormalizedOptions): PayloadHandler =>
	async (req) => {
		await authenticateRequest(req);

		const resolveDefault = async (): Promise<McpxAuthResult | null> =>
			resolveStrategyAuth(req, options) ??
			(await resolveApiKeyAuth(req, options));

		// Typed as unknown because a custom resolver's result is not trusted.
		const auth: unknown = options.auth?.resolve
			? await options.auth.resolve({ req, resolveDefault })
			: await resolveDefault();

		if (!isValidAuthResult(auth, options)) {
			if (auth) {
				req.payload.logger.error(
					"[payloadcms-mcpx] auth.resolve returned an invalid result: it needs a user of the user collection with an id, and either an apiKeyId or a principal.",
				);
			}

			return jsonRpcError({
				status: 401,
				code: -32001,
				message: "Unauthorized: a valid API key is required.",
				headers: { "www-authenticate": "Bearer" },
			});
		}

		const scope = await authenticateAs(req, options, auth);

		let parsedBody: unknown;
		try {
			const body = await readCapped(req, BODY_BYTES_LIMIT);

			if (body === null) {
				return jsonRpcError({
					status: 413,
					code: -32000,
					message: `Request body too large: the limit is ${String(BODY_BYTES_LIMIT / 1024 / 1024)} MB.`,
				});
			}

			parsedBody =
				body === undefined
					? undefined
					: JSON.parse(new TextDecoder().decode(body));
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
