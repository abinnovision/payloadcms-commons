import { handleEndpoints } from "payload";

import { CACHE_KEY } from "./payload.js";

import type { SanitizedConfig } from "payload";

const ENDPOINT = "http://localhost/api/mcpx";

let nextId = 0;

interface PostArgs {
	/** Payload instance cache key, when the spec booted its own instance. */
	cacheKey?: string;
	key?: string;
	body?: unknown;
	method?: string;
	headers?: Record<string, string>;
	rawBody?: string;
}

/**
 * Sends one HTTP request to the MCP endpoint through Payload's router, the
 * same path a Next.js route handler takes.
 */
export const mcpPost = (
	config: Promise<SanitizedConfig>,
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
			? { body: args.rawBody ?? JSON.stringify(args.body) }
			: {};

	return handleEndpoints({
		config,
		payloadInstanceCacheKey: args.cacheKey ?? CACHE_KEY,
		request: new Request(ENDPOINT, { method, headers, ...body }),
	});
};

interface RpcResponse {
	status: number;
	body: {
		result?: {
			tools?: { name: string; inputSchema: Record<string, unknown> }[];
			content?: { type: string; text: string }[];
			structuredContent?: unknown;
			isError?: boolean;
		};
		error?: { code: number; message: string };
	};
}

export const rpc = async (
	config: Promise<SanitizedConfig>,
	key: string | undefined,
	method: string,
	params?: unknown,
	cacheKey?: string,
): Promise<RpcResponse> => {
	const response = await mcpPost(config, {
		...(key === undefined ? {} : { key }),
		...(cacheKey === undefined ? {} : { cacheKey }),
		body: { jsonrpc: "2.0", id: ++nextId, method, params },
	});

	return {
		status: response.status,
		body: (await response.json()) as RpcResponse["body"],
	};
};

export interface ListedTool {
	name: string;
	inputSchema: Record<string, unknown>;
}

export const toolsList = async (
	config: Promise<SanitizedConfig>,
	key: string,
	cacheKey?: string,
): Promise<ListedTool[]> => {
	const { body } = await rpc(config, key, "tools/list", undefined, cacheKey);

	return body.result?.tools ?? [];
};

export const toolNames = async (
	config: Promise<SanitizedConfig>,
	key: string,
): Promise<string[]> => (await toolsList(config, key)).map((tool) => tool.name);

export interface CallResult {
	status: number;
	rpcError?: { code: number; message: string };
	isError: boolean;
	data: Record<string, unknown>;
	text: string | undefined;
}

/**
 * Calls one tool and parses its JSON text content. `data` is `{}` when the
 * result carries no JSON (for example an SDK validation error).
 */
export const callTool = async (
	config: Promise<SanitizedConfig>,
	key: string,
	name: string,
	args: Record<string, unknown> = {},
	cacheKey?: string,
): Promise<CallResult> => {
	const { status, body } = await rpc(
		config,
		key,
		"tools/call",
		{ name, arguments: args },
		cacheKey,
	);
	const text = body.result?.content?.[0]?.text;

	const parse = (): Record<string, unknown> => {
		try {
			return text ? (JSON.parse(text) as Record<string, unknown>) : {};
		} catch {
			return {};
		}
	};

	const data = parse();

	return {
		status,
		...(body.error ? { rpcError: body.error } : {}),
		isError: body.result?.isError === true,
		data,
		text,
	};
};

/** The enum of a tool's `collection` argument as published in `tools/list`. */
export const collectionEnumOf = (tool: ListedTool | undefined): string[] => {
	const properties = tool?.inputSchema["properties"] as
		Record<string, { enum?: string[] }> | undefined;

	return properties?.["collection"]?.enum ?? [];
};
