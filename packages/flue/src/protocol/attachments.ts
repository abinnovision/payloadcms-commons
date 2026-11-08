/**
 * The file types a chat turn may carry, which the providers Flue targets
 * all accept natively. The `attachments` option may narrow the list.
 */
export const ATTACHMENT_MIME_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"application/pdf",
] as const;

/** One of {@link ATTACHMENT_MIME_TYPES}. */
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

/**
 * One file of a chat turn in Flue's `DeliveredAttachment` shape: base64
 * bytes, an image or a PDF document, and the uploader's file name.
 */
export interface DeliveredAttachment {
	type: "document" | "image";
	/** Base64-encoded bytes. */
	data: string;
	mimeType: AttachmentMimeType;
	filename?: string;
}

/** The attachment `type` Flue expects for a MIME type. */
export const attachmentKind = (
	mimeType: AttachmentMimeType,
): DeliveredAttachment["type"] =>
	mimeType === "application/pdf" ? "document" : "image";

/** The attachment limits the agents endpoint answers, null when disabled. */
export interface AttachmentLimits {
	mimeTypes: AttachmentMimeType[];
	/** Largest decoded image, in bytes. */
	maxImageBytes: number;
	/** Largest decoded PDF, in bytes. */
	maxDocumentBytes: number;
	maxFiles: number;
}
