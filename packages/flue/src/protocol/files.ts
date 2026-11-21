const KIB = 1024;
const MIB = 1024 * KIB;
const HOUR = 60 * 60 * 1000;
const GIB = 1024 * MIB;

/**
 * The file types the chat's file workspace takes by default. `files.mimeTypes`
 * replaces the list; spread this one to extend it. Payload checks each
 * upload's content against the list.
 */
export const DEFAULT_FILE_MIME_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"application/pdf",
	"text/plain",
	"text/markdown",
	"text/csv",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

/** What a whole-file read takes by default; larger files are read by range. */
export const DEFAULT_READ_BYTES = 32 * MIB;

/**
 * The limits of the file workspace. `default` and `max` bound an option;
 * `pending` caps the files a user uploaded that no turn has claimed yet.
 */
export const FILE_LIMITS = {
	maxBytes: { default: 150 * MIB, max: 1024 * MIB },
	maxFilesPerTurn: { default: 10, max: 20 },
	maxFilesPerThread: 100,
	inlineTextBytes: { default: 0, max: 64 * KIB },
	pending: {
		files: { default: 20, max: 100 },
		bytes: { default: 300 * MIB, max: 10 * GIB },
		ttlMs: { default: 24 * HOUR, min: HOUR, max: 7 * 24 * HOUR },
	},
	/** The most files a thread's listing answers. */
	listMax: 100,
} as const;

/** Whether the string reads as an exact `type/subtype` MIME type. */
export const isMimeType = (mimeType: string): boolean =>
	/^[\w.+-]+\/[\w.+-]+$/.test(mimeType);

/**
 * A workspace file as a user's turn references it. `name` is the uploader's
 * file name and untrusted.
 */
export interface WorkspaceFileRef {
	/** The Payload id as text, as read from the turn body. */
	id: string;
	name: string;
	mimeType: string;
	/** In bytes. */
	size: number;
}

/** A workspace file of a thread, as the sidecar's listing answers it. */
export interface WorkspaceFile {
	/** The Payload id, as the collection's id type has it. */
	id: number | string;
	name: string;
	mimeType: string;
	/** In bytes. */
	size: number;
	createdAt: string;
}

/** The body the sidecar posts to list a thread's files. */
export interface FilesListRequest {
	handle: string;
	/** The slug the agent is mounted under in the sidecar. */
	agent: string;
}

/**
 * The headers the sidecar reads one file with, so the handle stays out of
 * the URL. The shared secret goes in `authorization`.
 */
export const FILE_HANDLE_HEADER = "x-flue-handle";
export const FILE_AGENT_HEADER = "x-flue-agent";
