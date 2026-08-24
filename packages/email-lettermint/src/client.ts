import { LettermintEmailError } from "./errors.js";
import { LETTERMINT_VERSION } from "./version.js";

import type { LettermintSendRequest } from "./message.js";
import type { LettermintSendResponse } from "./types.js";

const DEFAULT_BASE_URL = "https://api.lettermint.co/v1";
const DEFAULT_TIMEOUT = 30_000;

interface ClientOptions {
	apiToken: string;
	baseUrl: string;
	timeout: number;
}

/** The 422 body, which follows Laravel's validation envelope. */
interface ValidationBody {
	message?: string;
	errors?: Record<string, string[]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads the response body as JSON, falling back to text. Only `202` and `422`
 * are documented for this endpoint, so nothing about the shape can be assumed.
 */
const readBody = async (response: Response): Promise<unknown> => {
	const text = await response.text();

	if (text === "") {
		return undefined;
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
};

/**
 * Flattens the per-field messages into one sentence. The official SDK reads
 * this body as `body.error`, which does not exist, and so reports validation
 * failures as an empty string; keeping the detail is the point of this adapter
 * talking to the API directly.
 */
const describeValidation = (body: ValidationBody): string => {
	const entries = Object.entries(body.errors ?? {});

	if (entries.length === 0) {
		return body.message ?? "the request was rejected as invalid";
	}

	return entries
		.map(([field, messages]) => `${field}: ${messages.join(" ")}`)
		.join("; ");
};

const toError = (status: number, body: unknown): LettermintEmailError => {
	if (status === 422 && isRecord(body)) {
		const validation = body as ValidationBody;

		return new LettermintEmailError(
			`Lettermint rejected the message: ${describeValidation(validation)}`,
			{
				statusCode: status,
				body,
				...(validation.errors ? { errors: validation.errors } : {}),
			},
		);
	}

	const detail =
		isRecord(body) && typeof body["message"] === "string"
			? body["message"]
			: typeof body === "string" && body !== ""
				? body
				: undefined;

	return new LettermintEmailError(
		`Lettermint responded with ${String(status)}${detail ? `: ${detail}` : "."}`,
		{ statusCode: status, body },
	);
};

/**
 * Posts one message. Anything that is not a 2xx becomes a
 * {@link LettermintEmailError}; a transport failure or a timeout is wrapped
 * with the original error kept as the cause.
 */
const sendMessage = async (
	body: LettermintSendRequest,
	options: ClientOptions,
): Promise<LettermintSendResponse> => {
	let response: Response;

	try {
		response = await fetch(`${options.baseUrl}/send`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-lettermint-token": options.apiToken,
				"user-agent": `payloadcms-email-lettermint/${LETTERMINT_VERSION}`,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(options.timeout),
		});
	} catch (error) {
		const timedOut = error instanceof Error && error.name === "TimeoutError";

		throw new LettermintEmailError(
			timedOut
				? `Lettermint did not answer within ${String(options.timeout)}ms.`
				: "Could not reach Lettermint.",
			{ cause: error },
		);
	}

	const parsed = await readBody(response);

	if (!response.ok) {
		throw toError(response.status, parsed);
	}

	return parsed as LettermintSendResponse;
};

export { DEFAULT_BASE_URL, DEFAULT_TIMEOUT, sendMessage };
export type { ClientOptions };
