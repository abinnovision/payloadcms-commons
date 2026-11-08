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
}

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

	return {
		url: joinUrl(args.payloadUrl, args.mcpPath),
		auth: async () => (await exchange()).key,
		fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
			const response = await (args.fetch ?? fetch)(input, init);

			if (response.status === 401) {
				pending = undefined;
			}

			return response;
		},
		exchange,
	};
};
