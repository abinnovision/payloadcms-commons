import { FlueExchangeError, joinUrl } from "./exchange.js";
import {
	FILE_AGENT_HEADER,
	FILE_HANDLE_HEADER,
	FILE_LIMITS,
} from "../protocol/files.js";
import { isRecord } from "../protocol/guards.js";
import { routePath } from "../protocol/paths.js";

import type { ExchangeSession } from "./exchange.js";
import type {
	FilesListRequest,
	WorkspaceFile,
	WorkspaceFileRef,
} from "../protocol/files.js";

/** Why a file could not be read. */
export type FlueFileErrorCode =
	"budget_exhausted" | "not_found" | "refused" | "too_large" | "unavailable";

/**
 * Thrown when a file cannot be listed, read or downloaded, or a file tool's
 * budget is spent. Its message never carries the secret, the handle or a
 * download grant.
 */
export class FlueFileError extends Error {
	public override readonly name = "FlueFileError";

	public readonly code: FlueFileErrorCode;

	/** The status Payload answered with, `undefined` when none applies. */
	public readonly status: number | undefined;

	public constructor(
		code: FlueFileErrorCode,
		message: string,
		status?: number,
		options?: ErrorOptions,
	) {
		super(`[payloadcms-flue] ${message}`, options);
		this.code = code;
		this.status = status;
	}
}

/** A workspace file by its id, or a listed or referenced file. */
export type FileArg =
	number | Pick<WorkspaceFile, "id"> | Pick<WorkspaceFileRef, "id"> | string;

/** The files of the run's thread, read as its user. */
export interface PayloadFiles {
	/** The thread's files, oldest first. Empty outside a chat thread. */
	list: () => Promise<WorkspaceFile[]>;
	/**
	 * A file's bytes. Refuses with `too_large` past `maxBytes`, which
	 * defaults to `FILE_LIMITS.readBytes`; read larger files by range.
	 */
	read: (
		file: FileArg,
		options?: { maxBytes?: number; signal?: AbortSignal },
	) => Promise<Uint8Array>;
	/**
	 * A file's response. With `range`, bytes `start` to `end` inclusive as a
	 * 206, also when Payload ignores the range and answers the whole file.
	 */
	fetch: (
		file: FileArg,
		init?: {
			range?: { start: number; end: number };
			signal?: AbortSignal;
		},
	) => Promise<Response>;
}

export interface FilesTarget {
	payloadUrl: string;
	fluePath: string;
	secret: string;
	handle: string;
	agent: string;
	fetch?: typeof fetch;
}

const idOf = (file: FileArg): number | string =>
	typeof file === "object" ? file.id : file;

const failure = (status: number, what: string): FlueFileError => {
	if (status === 404) {
		return new FlueFileError("not_found", `${what} does not exist.`, status);
	}

	return status === 401 || status === 403 || status === 416
		? new FlueFileError(
				"refused",
				`Payload refused ${what} with status ${String(status)}.`,
				status,
			)
		: new FlueFileError(
				"unavailable",
				`Payload answered ${what} with status ${String(status)}.`,
				status,
			);
};

const unreachable = (what: string, error: unknown): FlueFileError =>
	new FlueFileError(
		"unavailable",
		`${what} did not reach Payload.`,
		undefined,
		{ cause: error },
	);

const tooLarge = (maxBytes: number): FlueFileError =>
	new FlueFileError(
		"too_large",
		`The file is larger than ${String(maxBytes)} bytes.`,
	);

const concat = (chunks: Uint8Array[], size: number): Uint8Array => {
	const bytes = new Uint8Array(size);
	let offset = 0;

	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return bytes;
};

/** Reads a body, cancelling it once it passes `maxBytes`. */
export const readCapped = async (
	response: Response,
	maxBytes: number,
): Promise<Uint8Array> => {
	if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
		await response.body?.cancel().catch(() => undefined);
		throw tooLarge(maxBytes);
	}

	const reader = response.body?.getReader();

	if (reader === undefined) {
		return new Uint8Array();
	}

	const chunks: Uint8Array[] = [];
	let size = 0;

	for (;;) {
		// eslint-disable-next-line no-await-in-loop
		const { done, value } = await reader.read();

		if (done) {
			break;
		}

		size += value.byteLength;

		if (size > maxBytes) {
			// eslint-disable-next-line no-await-in-loop
			await reader.cancel().catch(() => undefined);
			throw tooLarge(maxBytes);
		}

		chunks.push(value);
	}

	return concat(chunks, size);
};

// Bytes `start` to `end` inclusive of a whole-file body; the rest is cancelled.
const sliceOf = async (
	response: Response,
	start: number,
	end: number,
): Promise<Uint8Array> => {
	const reader = response.body?.getReader();

	if (reader === undefined) {
		return new Uint8Array();
	}

	const chunks: Uint8Array[] = [];
	let position = 0;
	let size = 0;

	while (position <= end) {
		// eslint-disable-next-line no-await-in-loop
		const { done, value } = await reader.read();

		if (done) {
			break;
		}

		const from = Math.max(start - position, 0);
		const to = Math.min(end + 1 - position, value.byteLength);

		if (from < to) {
			chunks.push(value.subarray(from, to));
			size += to - from;
		}

		position += value.byteLength;
	}

	await reader.cancel().catch(() => undefined);

	return concat(chunks, size);
};

/** Reads the workspace files of a handle's thread through the plugin's endpoints. */
export const createFiles = (target: FilesTarget): PayloadFiles => {
	const doFetch = target.fetch ?? fetch;
	const authorization = `Bearer ${target.secret}`;

	const fetchFile: PayloadFiles["fetch"] = async (file, init = {}) => {
		const { range, signal } = init;
		const id = idOf(file);
		let response: Response;

		try {
			response = await doFetch(
				joinUrl(
					target.payloadUrl,
					`${target.fluePath}${routePath("file", { file: id })}`,
				),
				{
					headers: {
						authorization,
						[FILE_HANDLE_HEADER]: target.handle,
						[FILE_AGENT_HEADER]: target.agent,
						...(range
							? { range: `bytes=${String(range.start)}-${String(range.end)}` }
							: {}),
					},
					signal: signal ?? null,
				},
			);
		} catch (error) {
			throw unreachable(`Reading file ${String(id)}`, error);
		}

		if (!response.ok) {
			await response.body?.cancel().catch(() => undefined);
			throw failure(response.status, `file ${String(id)}`);
		}

		if (!range || response.status === 206) {
			return response;
		}

		const size = response.headers.get("content-length") ?? "*";
		const slice = await sliceOf(response, range.start, range.end);
		const type = response.headers.get("content-type");

		// The range asks for at least one byte, so an empty slice starts past the end.
		if (slice.byteLength === 0) {
			throw failure(416, `file ${String(id)}`);
		}

		return new Response(slice as Uint8Array<ArrayBuffer>, {
			status: 206,
			headers: {
				"content-range": `bytes ${String(range.start)}-${String(range.start + slice.byteLength - 1)}/${size}`,
				...(type === null ? {} : { "content-type": type }),
			},
		});
	};

	return {
		list: async () => {
			const body: FilesListRequest = {
				handle: target.handle,
				agent: target.agent,
			};
			let response: Response;

			try {
				response = await doFetch(
					joinUrl(
						target.payloadUrl,
						`${target.fluePath}${routePath("filesList")}`,
					),
					{
						method: "POST",
						headers: { authorization, "content-type": "application/json" },
						body: JSON.stringify(body),
					},
				);
			} catch (error) {
				throw unreachable("Listing the files", error);
			}

			if (!response.ok) {
				await response.body?.cancel().catch(() => undefined);
				throw failure(response.status, "the thread's files");
			}

			const files: unknown = await response.json().catch(() => undefined);

			if (!Array.isArray(files)) {
				throw new FlueFileError(
					"unavailable",
					"Payload answered the listing without files.",
					response.status,
				);
			}

			return files as WorkspaceFile[];
		},
		read: async (file, options = {}) => {
			const response = await fetchFile(
				file,
				options.signal ? { signal: options.signal } : {},
			);

			return await readCapped(
				response,
				options.maxBytes ?? FILE_LIMITS.readBytes,
			);
		},
		fetch: fetchFile,
	};
};

export interface DownloadArgs {
	collection: string;
	id: number | string;
	/** Defaults to `FILE_LIMITS.readBytes`; past it the download is cancelled. */
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
	fetch?: typeof fetch;
}

const trimmed = (path: string): string => path.replace(/\/+$/, "");

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
	let doc: unknown;

	try {
		doc = await target.session.callTool("getDocument", {
			collection: args.collection,
			id: args.id,
			download: true,
		});
	} catch (error) {
		if (error instanceof FlueExchangeError) {
			throw error;
		}

		throw new FlueFileError(
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
		throw new FlueFileError(
			"not_found",
			`Document ${what} has no file to download.`,
		);
	}

	const filePath = `${trimmed(target.mcpPath)}/file`;
	let handoffPath: string;

	try {
		handoffPath = trimmed(new URL(download["url"]).pathname);
	} catch (error) {
		throw new FlueFileError(
			"refused",
			"mcpx returned an unparsable download URL.",
			undefined,
			{ cause: error },
		);
	}

	if (!handoffPath.endsWith(filePath)) {
		throw new FlueFileError(
			"refused",
			`mcpx returned a download outside "${filePath}", so it was not fetched.`,
		);
	}

	const headers = Object.fromEntries(
		Object.entries(download["headers"]).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
	let response: Response;

	try {
		response = await (target.fetch ?? fetch)(
			joinUrl(target.payloadUrl, filePath),
			{ headers, signal: args.signal ?? null },
		);
	} catch (error) {
		throw unreachable(`Downloading ${what}`, error);
	}

	if (response.status !== 200) {
		await response.body?.cancel().catch(() => undefined);
		throw failure(response.status, `the download of ${what}`);
	}

	const bytes = await readCapped(
		response,
		args.maxBytes ?? FILE_LIMITS.readBytes,
	);

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
