import { Buffer } from "node:buffer";

import { LettermintEmailError } from "./errors.js";

import type { Content } from "./nodemailer.js";

const isAsyncIterable = (value: object): value is AsyncIterable<unknown> =>
	Symbol.asyncIterator in value;

const unsupported = (reason: string): never => {
	throw new LettermintEmailError(reason);
};

/**
 * Drains a stream into one buffer. Covers both Node's `Readable` and a web
 * `ReadableStream`, since either can reach an adapter through user code.
 */
const collect = async (stream: AsyncIterable<unknown>): Promise<Buffer> => {
	const chunks: Buffer[] = [];

	for await (const chunk of stream) {
		if (typeof chunk === "string") {
			chunks.push(Buffer.from(chunk, "utf8"));
		} else if (ArrayBuffer.isView(chunk)) {
			chunks.push(
				Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
			);
		} else {
			unsupported(
				"A stream yielded a chunk that is neither a string nor bytes.",
			);
		}
	}

	return Buffer.concat(chunks);
};

/**
 * Resolves any nodemailer content value to a buffer. `path` is deliberately
 * refused: resolving it would read a local file or fetch a URL at send time,
 * which is exactly what nodemailer's `disableFileAccess` and `disableUrlAccess`
 * exist to prevent.
 */
const toBuffer = async (value: Content, field: string): Promise<Buffer> => {
	if (typeof value === "string") {
		return Buffer.from(value, "utf8");
	}

	if (Buffer.isBuffer(value)) {
		return value;
	}

	if (ArrayBuffer.isView(value)) {
		return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	}

	if (isAsyncIterable(value)) {
		return await collect(value);
	}

	if ("path" in value && value.path !== undefined) {
		return unsupported(
			`Attachment or body "${field}" uses "path", which this adapter does not resolve. Read the file yourself and pass "content".`,
		);
	}

	if ("content" in value && value.content !== undefined) {
		return await toBuffer(value.content, field);
	}

	return unsupported(`Attachment or body "${field}" carries no content.`);
};

/**
 * A body field as text. Lettermint takes `html` and `text` as strings.
 */
const toText = async (
	value: Content | undefined,
	field: string,
): Promise<string | undefined> => {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value === "string") {
		return value;
	}

	return (await toBuffer(value, field)).toString("utf8");
};

/**
 * Attachment content as base64, which is the only encoding Lettermint accepts.
 * A string already declared `base64` is passed through rather than encoded
 * twice.
 */
const toBase64 = async (
	value: Content,
	field: string,
	encoding?: string,
): Promise<string> => {
	if (typeof value === "string" && encoding === "base64") {
		return value;
	}

	if (typeof value === "string" && encoding !== undefined) {
		// Nodemailer accepts encodings Buffer does not, such as
		// "quoted-printable". Passing one straight to Buffer.from throws a bare
		// TypeError, so name the offending attachment instead.
		if (!Buffer.isEncoding(encoding)) {
			return unsupported(
				`Attachment "${field}" declares encoding "${encoding}", which this adapter cannot decode.`,
			);
		}

		return Buffer.from(value, encoding).toString("base64");
	}

	return (await toBuffer(value, field)).toString("base64");
};

export { toBase64, toText };
