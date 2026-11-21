/**
 * The file types Flue takes as attachments, which the providers Flue
 * targets all accept natively. Any other file reaches the model as a
 * reference only.
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
 * bytes, an image or a document, and the uploader's file name.
 */
export interface DeliveredAttachment {
	type: "document" | "image";
	/** Base64-encoded bytes. */
	data: string;
	mimeType: AttachmentMimeType;
	filename?: string;
}

/** Whether Flue takes the MIME type as an attachment. */
export const isAttachmentMimeType = (
	mimeType: string,
): mimeType is AttachmentMimeType =>
	(ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType);

/** The attachment `type` Flue expects for a MIME type. */
export const attachmentKind = (
	mimeType: AttachmentMimeType,
): DeliveredAttachment["type"] =>
	mimeType.startsWith("image/") ? "image" : "document";

const KIB = 1024;
const MIB = 1024 * KIB;

/**
 * The largest file Flue takes as one attachment: its cap of 14,680,064
 * base64 characters, decoded.
 */
export const ATTACHMENT_MAX_BYTES = (14_680_064 / 4) * 3;

/** The raw bytes all attachments of one turn may hold together. */
export const ATTACH_BYTES_PER_TURN = 16 * MIB;

/** How a file of a turn reaches the model. */
export type FileDelivery = "attach" | "reference";

/**
 * Decides per file whether it is attached to the turn or referenced only.
 * The plugin attaches only Flue's native types within its caps, whatever
 * the policy answers.
 */
export type FileDeliver = (file: {
	mimeType: string;
	size: number;
	agent: string;
}) => FileDelivery;

const IMAGE_MAX_BYTES = 3.75 * MIB;
const PDF_MAX_BYTES = 5 * MIB;

/**
 * Attaches images up to 3.75 MiB, which stay within Anthropic's 5 MiB
 * base64 image limit, and PDFs up to 5 MiB; references everything else.
 */
export const defaultDeliver: FileDeliver = ({ mimeType, size }) => {
	if (mimeType === "application/pdf") {
		return size <= PDF_MAX_BYTES ? "attach" : "reference";
	}

	return isAttachmentMimeType(mimeType) && size <= IMAGE_MAX_BYTES
		? "attach"
		: "reference";
};

/** Bytes as base64, in chunks that stay under the engines' argument limits. */
export const bytesToBase64 = (bytes: Uint8Array): string => {
	let binary = "";

	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}

	return btoa(binary);
};
