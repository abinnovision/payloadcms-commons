import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { resolveApiKeyAuth } from "../auth/resolve.js";
import {
	readableSlugs,
	resolveCapabilities,
	writableSlugs,
} from "../capabilities.js";
import { jsonRpcError } from "./result.js";
import { createMcpServer } from "./server.js";

import type { NormalizedOptions } from "../options.js";
import type { ToolScope } from "../tools/types.js";
import type { PayloadHandler, PayloadRequest } from "payload";

const buildScope = (
	req: PayloadRequest,
	options: NormalizedOptions,
	capabilities: ToolScope["capabilities"],
): ToolScope => {
	const { localization } = req.payload.config;

	return {
		req,
		options,
		capabilities,
		readable: readableSlugs(capabilities),
		writable: writableSlugs(capabilities),
		locales: localization ? localization.localeCodes : null,
		defaultLocale: localization ? localization.defaultLocale : null,
	};
};

/**
 * Answers GET and DELETE on the endpoint path. The server is stateless and
 * never streams, so only POST carries meaning.
 */
const methodNotAllowed: PayloadHandler = () =>
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
const createMcpxHandler =
	(options: NormalizedOptions): PayloadHandler =>
	async (req) => {
		const resolveDefault = (): ReturnType<typeof resolveApiKeyAuth> =>
			resolveApiKeyAuth(req, options);
		const auth = options.auth?.resolve
			? await options.auth.resolve({ req, resolveDefault })
			: await resolveDefault();

		if (!auth) {
			return jsonRpcError({
				status: 401,
				code: -32001,
				message: "Unauthorized: a valid API key is required.",
				headers: { "www-authenticate": "Bearer" },
			});
		}

		const capabilities = resolveCapabilities(options, auth.capabilities);

		req.user = auth.user;
		req.context = {
			...req.context,
			mcpx: { apiKeyId: auth.apiKeyId, capabilities },
		};

		let parsedBody: unknown;

		try {
			parsedBody = await req.json?.();
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

		const server = createMcpServer(buildScope(req, options, capabilities));
		// No session id generator means stateless: one transport per request.
		const transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
		});

		await server.connect(transport);

		// The transport insists on both media types in Accept; every answer is
		// JSON anyway, so the header is normalized rather than enforced.
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

export { createMcpxHandler, methodNotAllowed };
