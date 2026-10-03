import { handleEndpoints } from "payload";

import type { Booted } from "./payload.js";

const ENDPOINT = "http://localhost/api/mcpx";

let nextId = 0;

interface PostArgs {
	key?: string | undefined;
	body?: unknown;
	method?: string;
	headers?: Record<string, string>;
	/**
	 * A stream is sent chunked, without a Content-Length.
	 */
	rawBody?: string | ReadableStream<Uint8Array>;
}

/**
 * Sends one HTTP request to the MCP endpoint through Payload's router, the
 * same path a Next.js route handler takes. For a body or headers the client
 * below does not send.
 */
export const mcpPost = (
	booted: Booted,
	args: PostArgs = {},
): Promise<Response> => {
	const method = args.method ?? "POST";
	const headers: Record<string, string> = {
		accept: "application/json, text/event-stream",
		"content-type": "application/json",
		...(args.key === undefined ? {} : { authorization: `Bearer ${args.key}` }),
		...args.headers,
	};
	const body =
		method === "POST"
			? { body: args.rawBody ?? JSON.stringify(args.body), duplex: "half" }
			: {};

	return handleEndpoints({
		config: booted.config,
		payloadInstanceCacheKey: booted.cacheKey,
		request: new Request(ENDPOINT, { method, headers, ...body }),
	});
};

interface RpcResponse {
	status: number;
	body: {
		result?: {
			instructions?: string;
			tools?: ListedTool[];
			content?: { type: string; text: string }[];
			structuredContent?: unknown;
			isError?: boolean;
		};
		error?: { code: number; message: string };
	};
}

interface ListedTool {
	name: string;
	description?: string;
	annotations?: Record<string, unknown>;
	inputSchema: Record<string, unknown>;
}

export interface CallResult {
	status: number;
	rpcError?: { code: number; message: string };
	isError: boolean;
	data: Record<string, unknown>;
	text: string | undefined;
}

const parseJson = (text: string | undefined): Record<string, unknown> => {
	try {
		return text ? (JSON.parse(text) as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};

/**
 * The calls a spec makes against a booted instance, as one key.
 */
export const createMcpClient = (booted: Booted, key?: string) => {
	const rpc = async (
		method: string,
		params?: unknown,
	): Promise<RpcResponse> => {
		const response = await mcpPost(booted, {
			key,
			body: { jsonrpc: "2.0", id: ++nextId, method, params },
		});

		return {
			status: response.status,
			body: (await response.json()) as RpcResponse["body"],
		};
	};

	const list = async (): Promise<ListedTool[]> =>
		(await rpc("tools/list")).body.result?.tools ?? [];

	return {
		rpc,
		list,
		names: async (): Promise<string[]> =>
			(await list()).map((tool) => tool.name),

		/**
		 * The `instructions` the server reports on initialize.
		 */
		instructions: async (): Promise<string> =>
			(
				await rpc("initialize", {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "test", version: "0" },
				})
			).body.result?.instructions ?? "",

		/**
		 * Calls one tool and parses its JSON text content. `data` is `{}` when
		 * the result carries no JSON, for example an SDK validation error.
		 */
		call: async (
			name: string,
			args: Record<string, unknown> = {},
		): Promise<CallResult> => {
			const { status, body } = await rpc("tools/call", {
				name,
				arguments: args,
			});
			const text = body.result?.content?.[0]?.text;

			return {
				status,
				...(body.error ? { rpcError: body.error } : {}),
				isError: body.result?.isError === true,
				data: parseJson(text),
				text,
			};
		},

		/**
		 * Sends several tool calls in one JSON-RPC batch, which the server runs
		 * in order. Returns the results in request order.
		 */
		batch: async (
			calls: { name: string; args?: Record<string, unknown> }[],
		): Promise<{ id: number; isError: boolean }[]> => {
			const messages = calls.map((call) => ({
				jsonrpc: "2.0",
				id: ++nextId,
				method: "tools/call",
				params: { name: call.name, arguments: call.args ?? {} },
			}));
			const response = await mcpPost(booted, { key, body: messages });
			const body = (await response.json()) as {
				id: number;
				result?: { isError?: boolean };
			}[];
			const byId = new Map(
				(Array.isArray(body) ? body : [body]).map((entry) => [entry.id, entry]),
			);

			return messages.map((message) => ({
				id: message.id,
				isError: byId.get(message.id)?.result?.isError === true,
			}));
		},
	};
};

export type McpClient = ReturnType<typeof createMcpClient>;

/**
 * Everything a call answered with, result text and JSON-RPC error alike.
 */
export const responseText = (result: CallResult): string =>
	`${result.text ?? ""} ${result.rpcError?.message ?? ""}`;

/**
 * The enum of a tool's `collection` argument as published in `tools/list`.
 */
export const collectionEnumOf = (tool: ListedTool | undefined): string[] => {
	const properties = tool?.inputSchema["properties"] as
		Record<string, { enum?: string[] }> | undefined;

	return properties?.["collection"]?.enum ?? [];
};
