import { createHash, timingSafeEqual } from "node:crypto";
import { APIError } from "payload";

import type { PayloadHandler, PayloadRequest } from "payload";

/** A JSON response, never cached: every answer depends on the caller. */
export const json = (status: number, body: unknown): Response =>
	Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** The body every plugin endpoint refuses with. */
export const refusal = (status: number, error: string): Response =>
	json(status, { error });

/**
 * Answers a public `APIError` thrown by `handler` with its status and
 * message as `{ error }`. Anything else reaches Payload's error handler.
 */
export const endpointHandler =
	(handler: PayloadHandler): PayloadHandler =>
	async (req) => {
		try {
			return await handler(req);
		} catch (error) {
			if (error instanceof APIError && error.isPublic) {
				return refusal(error.status, error.message);
			}

			throw error;
		}
	};

/**
 * The body, `null` once it passes `max` bytes, or `undefined` when there is
 * none. A declared length over `max` is refused unread. A chunked body
 * declares none, so bytes are counted as they arrive and reading stops at
 * `max`.
 */
const readCapped = async (
	req: PayloadRequest,
	max: number,
): Promise<Buffer | null | undefined> => {
	if (Number(req.headers.get("content-length")) > max) {
		return null;
	}

	if (!req.body) {
		return undefined;
	}

	const chunks: Uint8Array[] = [];
	let size = 0;

	// Returning from inside the loop cancels the stream.
	for await (const chunk of req.body) {
		size += chunk.byteLength;

		if (size > max) {
			return null;
		}

		chunks.push(chunk);
	}

	return Buffer.concat(chunks);
};

/**
 * The parsed JSON body, or the refusal for a body over `max` bytes (413) or
 * one that is missing or not JSON (400).
 */
export const readJson = async (
	req: PayloadRequest,
	max: number,
): Promise<unknown> => {
	const body = await readCapped(req, max);

	if (body === null) {
		return refusal(
			413,
			`The request body is larger than ${String(max / 1024)} KiB.`,
		);
	}

	try {
		return JSON.parse(new TextDecoder().decode(body)) as unknown;
	} catch {
		return refusal(400, "The request body must be JSON.");
	}
};

/** 415 unless the request declares a JSON body. */
export const requireJson = (req: PayloadRequest): Response | undefined => {
	const type = req.headers.get("content-type")?.split(";")[0]?.trim();

	return type?.toLowerCase() === "application/json"
		? undefined
		: refusal(415, "The request must have the content type application/json.");
};

const digest = (value: string): Buffer =>
	createHash("sha256").update(value).digest();

/**
 * Whether an `Authorization` header carries `secret` as a Bearer token.
 * Both sides are hashed first, so the comparison takes the same time
 * whatever the token's length.
 */
export const secretMatches = (
	header: null | string | undefined,
	secret: string,
): boolean => {
	const token = /^Bearer (.+)$/.exec(header ?? "")?.[1];

	return token !== undefined && timingSafeEqual(digest(token), digest(secret));
};

const NUMERIC_ID = /^\d{1,20}$/;
const TEXT_ID = /^[\w-]{1,64}$/;

/**
 * Whether `value` has the form of a document id on the database adapter:
 * digits where ids are numbers, else word characters and hyphens, as
 * ObjectIds and UUIDs have. Other values are not looked up, since a numeric
 * id column refuses text with an error rather than a miss.
 */
export const isDocumentId = (
	req: PayloadRequest,
	value: unknown,
): value is string =>
	typeof value === "string" &&
	(req.payload.db.defaultIDType === "number" ? NUMERIC_ID : TEXT_ID).test(
		value,
	);

/**
 * The signed-in user, or the refusal: 401 without a session, 403 for a user
 * outside the mcpx user collection.
 */
export const requireUser = (
	req: PayloadRequest,
	userCollection: string,
): NonNullable<PayloadRequest["user"]> | Response => {
	if (!req.user) {
		return refusal(401, "Sign in to use the agents.");
	}

	if (req.user.collection !== userCollection) {
		return refusal(403, "This user cannot use the agents.");
	}

	return req.user;
};
