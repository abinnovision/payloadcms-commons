import * as v from "valibot";

import { FlueExchangeError, joinUrl } from "./exchange.js";
import { isRecord } from "../protocol/guards.js";

import type { ExchangeSession } from "./exchange.js";
import type { FilePartData, PayloadUpload } from "../protocol/events.js";

/**
 * Thrown when an upload cannot be completed. Its message never carries the
 * upload grant.
 */
export class FlueUploadError extends Error {
	public override readonly name = "FlueUploadError";

	/** The status of the PUT that failed, `undefined` before the PUT. */
	public readonly status: number | undefined;

	public constructor(message: string, status?: number, options?: ErrorOptions) {
		super(`[payloadcms-flue] ${message}`, options);
		this.status = status;
	}
}

export interface PayloadUploadArgs {
	/** An upload collection the agent may write, which sets `upload.mimeTypes`. */
	collection: string;
	filename: string;
	mimeType: string;
	/** The file's bytes; a string is sent as UTF-8. */
	data: Uint8Array | string;
	/** Values of the collection's own fields, such as `alt`. */
	fields?: Record<string, unknown>;
	/** The locale of `fields`. Defaults to the turn's locale. */
	locale?: string;
}

/** The data of a `data-payload-file` part, checked before every write. */
export const filePartSchema = v.object({
	files: v.array(
		v.object({
			collection: v.string(),
			id: v.union([v.string(), v.number()]),
			filename: v.string(),
			mimeType: v.string(),
			size: v.number(),
			adminUrl: v.string(),
		}),
	),
});

/*
 * The files uploaded during the live response of each conversation, by
 * handle. Keyed apart from the sessions, which may be evicted mid-response.
 * A conversation has one live response at a time.
 */
const responseFiles = new Map<string, PayloadUpload[]>();

/** Starts an empty file list for the conversation's new response. */
export const startResponseFiles = (handle: string): void => {
	responseFiles.set(handle, []);
};

/** Drops the file list once the conversation's response finished. */
export const finishResponseFiles = (handle: string): void => {
	responseFiles.delete(handle);
};

/** Adds a file to the conversation's response and returns the part to write. */
export const addResponseFile = (
	handle: string,
	file: PayloadUpload,
): FilePartData => {
	const current = responseFiles.get(handle);

	// A response that already finished keeps no list.
	if (current === undefined) {
		return { files: [file] };
	}

	const files = [...current, file];

	responseFiles.set(handle, files);

	return { files };
};

export interface UploadTarget {
	session: Pick<ExchangeSession, "callTool">;
	payloadUrl: string;
	mcpPath: string;
	/** The turn's locale, used when the call names none. */
	locale?: string | undefined;
	/** The fetch for the PUT. Defaults to the global one. */
	fetch?: typeof fetch;
}

const PREREQUISITES =
	"mcpx returned no upload handoff. Uploads need an upload collection the agent may write that sets upload.mimeTypes, and mcpx leases: Payload's database KV and no auth.resolve.";

const trimmed = (path: string): string => path.replace(/\/+$/, "");

const errorText = (body: unknown): string =>
	isRecord(body) && typeof body["error"] === "string" ? body["error"] : "";

// Calls `createDocument` and maps its failures; exchange errors pass through.
const requestHandoff = async (
	target: UploadTarget,
	args: PayloadUploadArgs,
	size: number,
): Promise<unknown> => {
	const locale = args.locale ?? target.locale;

	try {
		return await target.session.callTool("createDocument", {
			collection: args.collection,
			...(locale === undefined ? {} : { locale }),
			data: args.fields ?? {},
			file: { filename: args.filename, mimeType: args.mimeType, size },
		});
	} catch (error) {
		if (error instanceof FlueExchangeError) {
			throw error;
		}

		const message = (
			error instanceof Error ? error.message : String(error)
		).replace(/^\[payloadcms-flue\] /, "");

		if (locale === undefined && /\blocale\b/.test(message)) {
			throw new FlueUploadError(
				"The upload needs a locale: Payload is localized, and neither the turn nor the call names one.",
				undefined,
				{ cause: error },
			);
		}

		throw new FlueUploadError(
			`Payload refused the upload. ${message}`,
			undefined,
			{ cause: error },
		);
	}
};

/**
 * Creates a document in an upload collection: `createDocument` returns a
 * handoff, and the bytes are PUT to mcpx below `payloadUrl`, since the
 * handoff names Payload's public origin.
 */
export const uploadDocument = async (
	target: UploadTarget,
	args: PayloadUploadArgs,
): Promise<PayloadUpload> => {
	// The DOM typings take only views of an `ArrayBuffer`; fetch takes any view.
	const body = (
		typeof args.data === "string"
			? new TextEncoder().encode(args.data)
			: args.data
	) as Uint8Array<ArrayBuffer>;
	const result = await requestHandoff(target, args, body.byteLength);
	const upload = isRecord(result) ? result["upload"] : undefined;

	if (
		!isRecord(upload) ||
		typeof upload["url"] !== "string" ||
		!isRecord(upload["headers"])
	) {
		throw new FlueUploadError(PREREQUISITES);
	}

	const uploadPath = `${trimmed(target.mcpPath)}/upload`;
	let handoffPath: string;

	try {
		handoffPath = trimmed(new URL(upload["url"]).pathname);
	} catch (error) {
		throw new FlueUploadError(
			"mcpx returned an unparsable handoff URL.",
			undefined,
			{
				cause: error,
			},
		);
	}

	if (!handoffPath.endsWith(uploadPath)) {
		throw new FlueUploadError(
			`mcpx returned a handoff outside "${uploadPath}", so the file was not sent.`,
		);
	}

	const headers = Object.fromEntries(
		Object.entries(upload["headers"]).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
	let response: Response;

	try {
		response = await (target.fetch ?? fetch)(
			joinUrl(target.payloadUrl, uploadPath),
			{ method: "PUT", headers, body },
		);
	} catch (error) {
		throw new FlueUploadError("The upload did not reach Payload.", undefined, {
			cause: error,
		});
	}

	const written: unknown = await response.json().catch(() => undefined);

	if (response.status !== 200) {
		throw new FlueUploadError(
			`Payload answered the upload with status ${String(response.status)}. ${errorText(written)}`.trim(),
			response.status,
		);
	}

	if (
		!isRecord(written) ||
		(typeof written["id"] !== "string" && typeof written["id"] !== "number") ||
		typeof written["adminUrl"] !== "string"
	) {
		throw new FlueUploadError(
			"Payload answered the upload without the document.",
			response.status,
		);
	}

	return {
		collection: args.collection,
		id: written["id"],
		filename: args.filename,
		mimeType: args.mimeType,
		size: body.byteLength,
		adminUrl: written["adminUrl"],
	};
};
