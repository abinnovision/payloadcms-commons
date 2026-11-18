/**
 * The text file types a chat turn may carry. Flue takes no text documents,
 * so the plugin inlines them into the turn's body instead of attaching them.
 */
export const TEXT_MIME_TYPES = [
	"text/markdown",
	"text/plain",
	"text/csv",
] as const;

/**
 * The file types a chat turn may carry. Images and PDFs reach the model as
 * Flue attachments, which the providers Flue targets all accept natively;
 * text files as part of the turn's text. The `attachments` option may narrow
 * the list.
 */
export const ATTACHMENT_MIME_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"application/pdf",
	...TEXT_MIME_TYPES,
] as const;

/** One of {@link ATTACHMENT_MIME_TYPES}. */
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

/** One of {@link TEXT_MIME_TYPES}. */
export type TextMimeType = (typeof TEXT_MIME_TYPES)[number];

/**
 * One file of a chat turn in Flue's `DeliveredAttachment` shape: base64
 * bytes, an image or a document, and the uploader's file name.
 */
export interface DeliveredAttachment {
	type: "document" | "image";
	/** Base64-encoded bytes. */
	data: string;
	mimeType: AttachmentMimeType;
	filename?: string;
}

/** Whether the MIME type is one of {@link TEXT_MIME_TYPES}. */
export const isTextMimeType = (mimeType: string): mimeType is TextMimeType =>
	(TEXT_MIME_TYPES as readonly string[]).includes(mimeType);

/** The attachment `type` Flue expects for a MIME type. */
export const attachmentKind = (
	mimeType: AttachmentMimeType,
): DeliveredAttachment["type"] =>
	mimeType.startsWith("image/") ? "image" : "document";

/** The attachment limits the agents endpoint answers, null when disabled. */
export interface AttachmentLimits {
	mimeTypes: AttachmentMimeType[];
	/** Largest decoded image, in bytes. */
	maxImageBytes: number;
	/** Largest decoded PDF, in bytes. */
	maxDocumentBytes: number;
	/** Largest decoded text of all text files of a turn, in bytes. */
	maxTextBytes: number;
	maxFiles: number;
}

/** The largest decoded file of the MIME type the limits allow, in bytes. */
export const maxBytesOf = (
	limits: Pick<
		AttachmentLimits,
		"maxDocumentBytes" | "maxImageBytes" | "maxTextBytes"
	>,
	mimeType: AttachmentMimeType,
): number => {
	if (isTextMimeType(mimeType)) {
		return limits.maxTextBytes;
	}

	return attachmentKind(mimeType) === "image"
		? limits.maxImageBytes
		: limits.maxDocumentBytes;
};

/** Bytes as base64, in chunks that stay under the engines' argument limits. */
export const bytesToBase64 = (bytes: Uint8Array): string => {
	let binary = "";

	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}

	return btoa(binary);
};

/** UTF-8 text as base64. */
export const textToBase64 = (text: string): string =>
	bytesToBase64(new TextEncoder().encode(text));

/**
 * The text of UTF-8 bytes, or `undefined` when the bytes are not UTF-8 or
 * hold a NUL byte, which no text file the chat takes does. A leading byte
 * order mark is dropped.
 */
export const bytesToText = (bytes: Uint8Array): string | undefined => {
	let text: string;

	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return undefined;
	}

	return text.includes("\0") ? undefined : text;
};

/** {@link bytesToText} of base64 bytes. */
export const base64ToText = (data: string): string | undefined =>
	bytesToText(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)));
