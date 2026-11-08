import { isRecord } from "../protocol/guards.js";
import { routePath } from "../protocol/paths.js";

import type {
	ExchangeRequest,
	ExchangeResponse,
} from "../protocol/exchange.js";

/**
 * Thrown when Payload refuses or cannot answer a key exchange. Its message
 * never carries the secret or the handle.
 */
export class FlueExchangeError extends Error {
	public override readonly name = "FlueExchangeError";

	/** The status Payload answered with, `undefined` when no answer arrived. */
	public readonly status: number | undefined;

	public constructor(
		message: string,
		status: number | undefined,
		options?: ErrorOptions,
	) {
		super(`[payloadcms-flue] ${message}`, options);
		this.status = status;
	}
}

export interface ExchangeKeyArgs {
	/** The Payload server URL, such as `https://cms.example.com`. */
	payloadUrl: string;
	/** The plugin's endpoints below `payloadUrl`: `routes.api` plus its `endpointPath`. */
	fluePath: string;
	secret: string;
	handle: string;
	/** The slug the agent is mounted under in the sidecar. */
	agent: string;
	fetch?: typeof fetch;
}

// Keeps a path prefix of `base`, which `new URL(path, base)` would drop.
export const joinUrl = (base: string, path: string): string =>
	`${base.replace(/\/+$/, "")}${path}`;

const REFUSALS: Readonly<Record<number, string>> = {
	401: "Payload refused the sidecar secret.",
	404: "Payload has no live conversation for this handle and agent.",
};

const isExchangeResponse = (value: unknown): value is ExchangeResponse =>
	typeof value === "object" &&
	value !== null &&
	"key" in value &&
	typeof value.key === "string" &&
	value.key !== "" &&
	"mcpPath" in value &&
	typeof value.mcpPath === "string";

/** Trades the conversation's handle for its mcpx key at Payload's exchange endpoint. */
export const exchangeKey = async (
	args: ExchangeKeyArgs,
): Promise<ExchangeResponse> => {
	const body: ExchangeRequest = { handle: args.handle, agent: args.agent };
	let response: Response;

	try {
		response = await (args.fetch ?? fetch)(
			joinUrl(args.payloadUrl, `${args.fluePath}${routePath("exchange")}`),
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${args.secret}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			},
		);
	} catch (error) {
		throw new FlueExchangeError(
			"The key exchange did not reach Payload.",
			undefined,
			{ cause: error },
		);
	}

	if (!response.ok) {
		throw new FlueExchangeError(
			REFUSALS[response.status] ??
				`Payload answered the key exchange with status ${String(response.status)}.`,
			response.status,
		);
	}

	const result: unknown = await response.json().catch(() => undefined);

	if (!isExchangeResponse(result)) {
		throw new FlueExchangeError(
			"Payload answered the key exchange without a key.",
			response.status,
		);
	}

	return result;
};

export interface ExchangeSessionArgs extends ExchangeKeyArgs {
	/** The mcpx endpoint below `payloadUrl`, which must equal the one Payload reports. */
	mcpPath: string;
}

/** An mcpx connection whose key comes from a lazy, cached exchange. */
export interface ExchangeSession {
	/** The mcpx endpoint URL. */
	url: string;
	/** Resolves the key, exchanging on first use and after mcpx answered 401. */
	auth: () => Promise<string>;
	/** The MCP transport's fetch; a 401 drops the cached exchange. */
	fetch: typeof fetch;
	/** Resolves the cached exchange result. */
	exchange: () => Promise<ExchangeResponse>;
	/**
	 * Calls one mcpx tool with a single JSON-RPC `tools/call`, exchanging
	 * again and retrying once after a 401. Resolves the structured content or
	 * the parsed first text block; throws when the tool reports an error.
	 */
	callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

const toolError = (message: string): Error =>
	new Error(`[payloadcms-flue] ${message}`);

// The JSON of a text block, or the text itself when it is not JSON.
const parseText = (text: string): unknown => {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
};

// What a `tools/call` answer carries, or throws for an error of any layer.
const toolResult = (name: string, answer: unknown): unknown => {
	if (!isRecord(answer)) {
		throw toolError(`mcpx answered "${name}" without a JSON-RPC result.`);
	}

	if (isRecord(answer["error"])) {
		throw toolError(
			`mcpx refused "${name}": ${String(answer["error"]["message"])}`,
		);
	}

	const result = answer["result"];

	if (!isRecord(result)) {
		throw toolError(`mcpx answered "${name}" without a JSON-RPC result.`);
	}

	const content: unknown[] = Array.isArray(result["content"])
		? result["content"]
		: [];
	const [first] = content;
	const text =
		isRecord(first) && typeof first["text"] === "string"
			? parseText(first["text"])
			: undefined;

	if (result["isError"] === true) {
		const message =
			isRecord(text) && typeof text["error"] === "string"
				? text["error"]
				: String(text);

		throw toolError(`"${name}" failed: ${message}`);
	}

	return result["structuredContent"] ?? text;
};

/**
 * The URL, auth resolver and fetch for one mcpx connection. The key is held
 * in this closure only; a failed exchange is not cached.
 */
export const exchangeSession = (args: ExchangeSessionArgs): ExchangeSession => {
	let pending: Promise<ExchangeResponse> | undefined;

	const exchange = (): Promise<ExchangeResponse> => {
		if (pending === undefined) {
			const attempt = exchangeKey(args).then((response) => {
				if (response.mcpPath !== args.mcpPath) {
					throw new FlueExchangeError(
						`Payload serves mcpx at "${response.mcpPath}", not at the configured "${args.mcpPath}".`,
						undefined,
					);
				}

				return response;
			});

			pending = attempt;
			attempt.catch(() => {
				if (pending === attempt) {
					pending = undefined;
				}
			});
		}

		return pending;
	};

	const url = joinUrl(args.payloadUrl, args.mcpPath);

	const sessionFetch = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const response = await (args.fetch ?? fetch)(input, init);

		if (response.status === 401) {
			pending = undefined;
		}

		return response;
	};

	// mcpx is stateless, so a single call needs no `initialize` first.
	const post = async (body: string): Promise<Response> =>
		await sessionFetch(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${(await exchange()).key}`,
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
			},
			body,
		});

	return {
		url,
		auth: async () => (await exchange()).key,
		fetch: sessionFetch,
		exchange,
		callTool: async (name, toolArgs) => {
			const body = JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name, arguments: toolArgs },
			});
			let response = await post(body);

			if (response.status === 401) {
				response = await post(body);
			}

			if (!response.ok) {
				throw toolError(
					`mcpx answered "${name}" with status ${String(response.status)}.`,
				);
			}

			return toolResult(name, await response.json().catch(() => undefined));
		},
	};
};
