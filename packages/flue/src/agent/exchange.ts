import { isRecord } from "../protocol/guards.js";
import { routePath } from "../protocol/paths.js";

import type {
	ExchangeRequest,
	ExchangeResponse,
} from "../protocol/exchange.js";

/** Why a call to Payload failed. */
export type FluePayloadErrorCode =
	"not_found" | "refused" | "too_large" | "unauthorized" | "unreachable";

/**
 * Thrown when Payload refuses or cannot answer a call of `./agent`. Its
 * message never carries the secret, the handle or a grant.
 */
export class FluePayloadError extends Error {
	public override readonly name = "FluePayloadError";

	public readonly code: FluePayloadErrorCode;

	/** The status Payload answered with, `undefined` when none applies. */
	public readonly status: number | undefined;

	public constructor(
		code: FluePayloadErrorCode,
		message: string,
		status?: number,
		options?: ErrorOptions,
	) {
		super(`[payloadcms-flue] ${message}`, options);
		this.code = code;
		this.status = status;
	}
}

/** The code of an HTTP failure status. */
export const codeOf = (status: number): FluePayloadErrorCode => {
	if (status === 401) {
		return "unauthorized";
	}

	if (status === 404) {
		return "not_found";
	}

	if (status === 413) {
		return "too_large";
	}

	return status < 500 ? "refused" : "unreachable";
};

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

/** Trades the conversation's handle for its thread's token at Payload's exchange endpoint. */
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
		throw new FluePayloadError(
			"unreachable",
			"The token exchange did not reach Payload.",
			undefined,
			{ cause: error },
		);
	}

	if (!response.ok) {
		throw new FluePayloadError(
			codeOf(response.status),
			REFUSALS[response.status] ??
				`Payload answered the token exchange with status ${String(response.status)}.`,
			response.status,
		);
	}

	const result: unknown = await response.json().catch(() => undefined);

	if (!isExchangeResponse(result)) {
		throw new FluePayloadError(
			"refused",
			"Payload answered the token exchange without a token.",
			response.status,
		);
	}

	return result;
};

export interface ExchangeSessionArgs extends ExchangeKeyArgs {
	/** The mcpx endpoint below `payloadUrl`, which must equal the one Payload reports. */
	mcpPath: string;
}

/** An mcpx connection whose token comes from a lazy, cached exchange. */
export interface ExchangeSession {
	/** The mcpx endpoint URL. */
	url: string;
	/**
	 * Resolves the token, exchanging on first use, after Payload answered 401
	 * and when the cached token has less than two minutes left.
	 */
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
	/**
	 * Requests `path` below the Payload URL with the token as bearer,
	 * exchanging again and retrying once after a 401, so `init.body` must be
	 * one that can be sent twice. For trusted agent code only: never back a
	 * model tool with it, as the token is a full user session over REST.
	 */
	request: (path: string, init?: RequestInit) => Promise<Response>;
}

// A cached token this close to its expiry is exchanged again before use.
const REFRESH_BEFORE_MS = 2 * 60_000;

const toolError = (message: string, status?: number): FluePayloadError =>
	new FluePayloadError(
		status === undefined ? "refused" : codeOf(status),
		message,
		status,
	);

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
 * The URL, auth resolver and fetch for one mcpx connection. The token is held
 * in this closure only; a failed exchange is not cached.
 */
export const exchangeSession = (args: ExchangeSessionArgs): ExchangeSession => {
	let pending: Promise<ExchangeResponse> | undefined;
	// When the cached token counts as stale; never for a token that cannot be renewed early.
	let expiresAt = Number.POSITIVE_INFINITY;
	let lastExp = Number.NEGATIVE_INFINITY;

	const exchange = (): Promise<ExchangeResponse> => {
		if (pending !== undefined && expiresAt - Date.now() < REFRESH_BEFORE_MS) {
			pending = undefined;
		}

		if (pending === undefined) {
			expiresAt = Number.POSITIVE_INFINITY;

			const attempt = exchangeKey(args).then((response) => {
				if (response.mcpPath !== args.mcpPath) {
					throw new FluePayloadError(
						"refused",
						`Payload serves mcpx at "${response.mcpPath}", not at the configured "${args.mcpPath}".`,
					);
				}

				if (pending === attempt) {
					const exp = Date.parse(response.expiresAt);

					// A token no later than the last one comes from a closing window, which only a 401 ends.
					expiresAt = exp > lastExp ? exp : Number.POSITIVE_INFINITY;
					lastExp = exp;
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

	const withBearer = async (path: string, init?: RequestInit) => {
		const headers = new Headers(init?.headers);

		headers.set("authorization", `Bearer ${(await exchange()).key}`);

		return await (args.fetch ?? fetch)(joinUrl(args.payloadUrl, path), {
			...init,
			headers,
		});
	};

	return {
		url,
		auth: async () => (await exchange()).key,
		fetch: sessionFetch,
		exchange,
		request: async (path, init) => {
			// A path that is not absolute could lead the bearer to another host.
			if (!path.startsWith("/")) {
				throw new FluePayloadError(
					"refused",
					`The path "${path}" must start with "/".`,
				);
			}

			const response = await withBearer(path, init);

			if (response.status !== 401) {
				return response;
			}

			pending = undefined;
			await response.body?.cancel().catch(() => undefined);

			return await withBearer(path, init);
		},
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
					response.status,
				);
			}

			return toolResult(name, await response.json().catch(() => undefined));
		},
	};
};
