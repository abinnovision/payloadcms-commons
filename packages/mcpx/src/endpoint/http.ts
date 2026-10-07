import { grantKvSlug } from "../grants/grant.js";

import type { NormalizedOptions } from "../options.js";
import type { PayloadRequest } from "payload";

export const respond = (status: number, body: unknown): Response =>
	Response.json(body, { status });

/**
 * The body, `null` once it passes `max` bytes, or `undefined` when there is
 * none. A declared length over `max` is refused unread. A chunked body
 * declares none, so bytes are counted as they arrive and reading stops at
 * `max`.
 */
export const readCapped = async (
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
 * The grant KV slug where uploads, downloads and confirmations are possible:
 * the KV is database-backed and no custom `auth.resolve` is set, since the
 * grant endpoints cannot replay what such a resolver authenticated by.
 */
export const grantsAvailable = (
	req: PayloadRequest,
	options: NormalizedOptions,
): string | undefined =>
	options.auth?.resolve === undefined
		? grantKvSlug(req.payload.config)
		: undefined;
