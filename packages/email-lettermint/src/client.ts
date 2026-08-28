import {
	EmailEndpoint,
	HttpRequestError,
	LettermintClient,
	TimeoutError,
	ValidationError,
} from "lettermint";

import { LettermintEmailError } from "./errors.js";

import type { LettermintSendRequest } from "./message.js";
import type { LettermintSendResponse } from "./types.js";

interface ClientOptions {
	apiToken: string;
	baseUrl?: string | undefined;
	timeout?: number | undefined;
}

/**
 * The 422 body, which follows Laravel's validation envelope.
 */
interface ValidationBody {
	message?: string;
	errors?: Record<string, string[]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Flattens the per-field messages into one sentence. The SDK reads this body as
 * `body.error`, which does not exist, so its own message carries no detail;
 * reading `responseBody` here keeps it.
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

const toValidationError = (error: ValidationError): LettermintEmailError => {
	const body = error.responseBody;
	const validation: ValidationBody = isRecord(body) ? body : {};

	return new LettermintEmailError(
		`Lettermint rejected the message: ${describeValidation(validation)}`,
		{
			statusCode: error.statusCode,
			body,
			...(validation.errors ? { errors: validation.errors } : {}),
		},
	);
};

const toHttpError = (error: HttpRequestError): LettermintEmailError => {
	const body = error.responseBody;
	const detail =
		isRecord(body) && typeof body["message"] === "string"
			? body["message"]
			: typeof body === "string" && body !== ""
				? body
				: undefined;

	return new LettermintEmailError(
		`Lettermint responded with ${String(error.statusCode)}${detail ? `: ${detail}` : "."}`,
		{ statusCode: error.statusCode, body },
	);
};

/**
 * Builds the request on a fresh endpoint wrapping the shared client. The SDK's
 * builder mutates `this.payload` in place and only resets once a send
 * resolves, so sharing an endpoint across concurrent sends would let them
 * overwrite each other; the client itself is stateless and safe to reuse.
 */
const buildEndpoint = (
	body: LettermintSendRequest,
	client: LettermintClient,
): EmailEndpoint => {
	const endpoint = new EmailEndpoint(client);

	endpoint
		.from(body.from)
		.to(...body.to)
		.subject(body.subject);

	if (body.cc && body.cc.length > 0) {
		endpoint.cc(...body.cc);
	}

	if (body.bcc && body.bcc.length > 0) {
		endpoint.bcc(...body.bcc);
	}

	if (body.reply_to && body.reply_to.length > 0) {
		endpoint.replyTo(...body.reply_to);
	}

	if (body.html !== undefined) {
		endpoint.html(body.html);
	}

	if (body.text !== undefined) {
		endpoint.text(body.text);
	}

	if (body.headers) {
		endpoint.headers(body.headers);
	}

	if (body.route !== undefined) {
		endpoint.route(body.route);
	}

	if (body.settings) {
		endpoint.settings(body.settings);
	}

	if (body.metadata) {
		endpoint.metadata(body.metadata);
	}

	if (body.tags) {
		endpoint.tags(body.tags);
	}

	for (const attachment of body.attachments ?? []) {
		endpoint.attach(
			attachment.filename,
			attachment.content,
			attachment.content_id,
			attachment.content_type,
		);
	}

	return endpoint;
};

/**
 * Builds a client from resolved options. Does no I/O.
 */
export const createLettermintClient = (
	options: ClientOptions,
): LettermintClient =>
	new LettermintClient({
		apiToken: options.apiToken,
		...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
		...(options.timeout ? { timeout: options.timeout } : {}),
	});

/**
 * Sends one message through the Lettermint SDK.
 *
 * Anything the API refuses becomes a {@link LettermintEmailError};
 * a transport failure or a timeout is wrapped with the original error
 * kept as the cause.
 */
export const sendMessage = async (
	body: LettermintSendRequest,
	client: LettermintClient,
): Promise<LettermintSendResponse> => {
	try {
		return (await buildEndpoint(body, client).send()) as LettermintSendResponse;
	} catch (error) {
		if (error instanceof ValidationError) {
			throw toValidationError(error);
		}

		if (error instanceof HttpRequestError) {
			throw toHttpError(error);
		}

		throw new LettermintEmailError(
			error instanceof TimeoutError
				? "Lettermint did not answer within the configured timeout."
				: "Could not reach Lettermint.",
			{ cause: error },
		);
	}
};
