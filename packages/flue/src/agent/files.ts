import { codeOf, FluePayloadError, joinUrl } from "./exchange.js";
import { handoffRequest } from "./handoff.js";
import { readBytes } from "../protocol/body.js";
import { isRecord } from "../protocol/guards.js";

import type { ExchangeSession } from "./exchange.js";

/** What a whole-file read takes by default. */
const DEFAULT_READ_BYTES = 32 * 1024 * 1024;

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

interface DownloadTarget {
	/** `auth` gives the bearer mcpx requires on the GET of a token's grant. */
	session: Pick<ExchangeSession, "auth" | "callTool">;
	payloadUrl: string;
	mcpPath: string;
	fetch?: typeof fetch;
}

const isRange = ({ start, end }: { start: number; end?: number }): boolean =>
	Number.isSafeInteger(start) &&
	start >= 0 &&
	(end === undefined || (Number.isSafeInteger(end) && end >= start));

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
	const { range } = args;

	if (range !== undefined && !isRange(range)) {
		throw new FluePayloadError(
			"refused",
			"A range needs a whole start of at least 0 and an end not before it.",
		);
	}

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

	const record = isRecord(doc) ? doc : {};
	const { path, headers } = handoffRequest(
		record["download"],
		target.mcpPath,
		"file",
		new FluePayloadError(
			"not_found",
			`Document ${what} has no file to download.`,
		),
	);

	headers["authorization"] = `Bearer ${await target.session.auth()}`;

	if (range) {
		headers["range"] =
			`bytes=${String(range.start)}-${range.end === undefined ? "" : String(range.end)}`;
	}

	let response: Response;

	try {
		response = await (target.fetch ?? fetch)(joinUrl(target.payloadUrl, path), {
			headers,
			signal: args.signal ?? null,
		});
	} catch (error) {
		throw new FluePayloadError(
			"unreachable",
			`Downloading ${what} did not reach Payload.`,
			undefined,
			{ cause: error },
		);
	}

	if (response.status !== 200 && response.status !== 206) {
		await response.body?.cancel().catch(() => undefined);
		throw new FluePayloadError(
			codeOf(response.status),
			response.status === 404
				? `the download of ${what} does not exist.`
				: `Payload answered the download of ${what} with status ${String(response.status)}.`,
			response.status,
		);
	}

	// A server that ignores the range answers the whole file with a 200.
	const bytes = await readBytes(
		response,
		maxBytes,
		response.status === 200 ? range : undefined,
	);

	if (bytes === undefined) {
		throw new FluePayloadError(
			"too_large",
			`The file is larger than ${String(maxBytes)} bytes.`,
		);
	}

	return {
		filename:
			typeof record["filename"] === "string"
				? record["filename"]
				: String(args.id),
		mimeType:
			typeof record["mimeType"] === "string"
				? record["mimeType"]
				: (response.headers.get("content-type") ?? ""),
		bytes,
	};
};
