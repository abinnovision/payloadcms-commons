import { codeOf, FluePayloadError, joinUrl } from "./exchange.js";
import { concat, readCapped as readBody } from "../protocol/body.js";
import { FILE_HANDLE_HEADER } from "../protocol/files.js";
import { isRecord } from "../protocol/guards.js";

import type { ExchangeSession } from "./exchange.js";

/** What a whole-file read takes by default. */
const DEFAULT_READ_BYTES = 32 * 1024 * 1024;

const failure = (status: number, what: string): FluePayloadError =>
	new FluePayloadError(
		codeOf(status),
		status === 404
			? `${what} does not exist.`
			: `Payload answered ${what} with status ${String(status)}.`,
		status,
	);

const unreachable = (what: string, error: unknown): FluePayloadError =>
	new FluePayloadError(
		"unreachable",
		`${what} did not reach Payload.`,
		undefined,
		{ cause: error },
	);

const tooLarge = (maxBytes: number): FluePayloadError =>
	new FluePayloadError(
		"too_large",
		`The file is larger than ${String(maxBytes)} bytes.`,
	);

/** Reads a body, cancelling it once it passes `maxBytes`. */
export const readCapped = async (
	response: Response,
	maxBytes: number,
): Promise<Uint8Array> => {
	const bytes = await readBody(response, maxBytes);

	if (bytes === undefined) {
		throw tooLarge(maxBytes);
	}

	return bytes;
};

/**
 * Bytes `start` to `end` inclusive of a whole-file body, to its end without
 * `end`. Bytes before `start` are discarded and the rest is cancelled, so
 * memory stays bounded by the slice.
 */
export const sliceOf = async (
	response: Response,
	range: { start: number; end?: number | undefined },
	maxBytes = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> => {
	const reader = response.body?.getReader();

	if (reader === undefined) {
		return new Uint8Array();
	}

	const end = range.end ?? Number.POSITIVE_INFINITY;
	const chunks: Uint8Array[] = [];
	let position = 0;
	let size = 0;

	while (position <= end) {
		// eslint-disable-next-line no-await-in-loop
		const { done, value } = await reader.read();

		if (done) {
			break;
		}

		const from = Math.max(range.start - position, 0);
		const to = Math.min(end + 1 - position, value.byteLength);

		if (from < to) {
			size += to - from;

			if (size > maxBytes) {
				// eslint-disable-next-line no-await-in-loop
				await reader.cancel().catch(() => undefined);
				throw tooLarge(maxBytes);
			}

			chunks.push(value.subarray(from, to));
		}

		position += value.byteLength;
	}

	await reader.cancel().catch(() => undefined);

	return concat(chunks, size);
};

export interface DownloadArgs {
	collection: string;
	id: number | string;
	/**
	 * Bytes `start` to `end` inclusive, to the end of the file without `end`.
	 * Each read takes one download grant, so read large chunks.
	 */
	range?: { start: number; end?: number };
	/** Defaults to 32 MiB; past it the download is cancelled. */
	maxBytes?: number;
	signal?: AbortSignal;
}

export interface Download {
	filename: string;
	mimeType: string;
	bytes: Uint8Array;
}

export interface DownloadTarget {
	session: Pick<ExchangeSession, "callTool">;
	payloadUrl: string;
	mcpPath: string;
	/** The conversation's handle, which scopes the read to its thread. */
	handle: string;
	fetch?: typeof fetch;
}

const trimmed = (path: string): string => path.replace(/\/+$/, "");

// Refuses a range without a whole start of at least 0 and a whole end not before it.
const assertRange = (range: DownloadArgs["range"]): void => {
	if (
		range === undefined ||
		(Number.isSafeInteger(range.start) &&
			range.start >= 0 &&
			(range.end === undefined ||
				(Number.isSafeInteger(range.end) && range.end >= range.start)))
	) {
		return;
	}

	throw new FluePayloadError(
		"refused",
		"A range needs a whole start of at least 0 and an end not before it.",
	);
};

const rangeHeader = (range: { start: number; end?: number }): string =>
	`bytes=${String(range.start)}-${range.end === undefined ? "" : String(range.end)}`;

/**
 * Downloads the file of an upload collection's document as the run's user:
 * mcpx `getDocument` hands off a download grant, and the file is fetched
 * below `payloadUrl`, since the handoff names Payload's public origin.
 */
export const downloadDocument = async (
	target: DownloadTarget,
	args: DownloadArgs,
): Promise<Download> => {
	const what = `${args.collection} ${String(args.id)}`;
	const maxBytes = args.maxBytes ?? DEFAULT_READ_BYTES;
	assertRange(args.range);

	let doc: unknown;

	try {
		doc = await target.session.callTool("getDocument", {
			collection: args.collection,
			id: args.id,
			download: true,
		});
	} catch (error) {
		if (error instanceof FluePayloadError) {
			throw error;
		}

		throw new FluePayloadError(
			"refused",
			(error instanceof Error ? error.message : String(error)).replace(
				/^\[payloadcms-flue\] /,
				"",
			),
			undefined,
			{ cause: error },
		);
	}

	const download = isRecord(doc) ? doc["download"] : undefined;

	if (
		!isRecord(doc) ||
		!isRecord(download) ||
		typeof download["url"] !== "string" ||
		!isRecord(download["headers"])
	) {
		throw new FluePayloadError(
			"not_found",
			`Document ${what} has no file to download.`,
		);
	}

	const filePath = `${trimmed(target.mcpPath)}/file`;
	let handoffPath: string;

	try {
		handoffPath = trimmed(new URL(download["url"]).pathname);
	} catch (error) {
		throw new FluePayloadError(
			"refused",
			"mcpx returned an unparsable download URL.",
			undefined,
			{ cause: error },
		);
	}

	if (!handoffPath.endsWith(filePath)) {
		throw new FluePayloadError(
			"refused",
			`mcpx returned a download outside "${filePath}", so it was not fetched.`,
		);
	}

	const headers: Record<string, string> = {
		...Object.fromEntries(
			Object.entries(download["headers"]).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		),
		[FILE_HANDLE_HEADER]: target.handle,
		...(args.range ? { range: rangeHeader(args.range) } : {}),
	};
	let response: Response;

	try {
		response = await (target.fetch ?? fetch)(
			joinUrl(target.payloadUrl, filePath),
			{ headers, signal: args.signal ?? null },
		);
	} catch (error) {
		throw unreachable(`Downloading ${what}`, error);
	}

	if (response.status !== 200 && response.status !== 206) {
		await response.body?.cancel().catch(() => undefined);
		throw failure(response.status, `the download of ${what}`);
	}

	// A server that ignores the range answers the whole file with a 200.
	const bytes =
		args.range && response.status === 200
			? await sliceOf(response, args.range, maxBytes)
			: await readCapped(response, maxBytes);

	return {
		filename:
			typeof doc["filename"] === "string" ? doc["filename"] : String(args.id),
		mimeType:
			typeof doc["mimeType"] === "string"
				? doc["mimeType"]
				: (response.headers.get("content-type") ?? ""),
		bytes,
	};
};
