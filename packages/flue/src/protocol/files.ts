const KIB = 1024;
const MIB = 1024 * KIB;
const HOUR = 60 * 60 * 1000;

/**
 * The file types the chat's file workspace takes. The `files` option may
 * narrow the list. Payload checks each upload's content against it.
 */
export const FILE_MIME_TYPES = [
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

/** One of {@link FILE_MIME_TYPES}. */
export type FileMimeType = (typeof FILE_MIME_TYPES)[number];

/**
 * The limits of the file workspace. `default` and `max` bound an option;
 * `pending` caps the files a user uploaded that no turn has claimed yet.
 */
export const FILE_LIMITS = {
	maxBytes: { default: 150 * MIB, max: 1024 * MIB },
	maxFilesPerTurn: { default: 10, max: 20 },
	maxFilesPerThread: 100,
	inlineTextBytes: { default: 0, max: 64 * KIB },
	pending: { files: 20, bytes: 300 * MIB, ttlMs: 24 * HOUR },
	/** What a whole-file read takes by default; larger files are read by range. */
	readBytes: 32 * MIB,
	/** The most files a thread's listing answers. */
	listMax: 100,
} as const;

/** Whether the MIME type is one of {@link FILE_MIME_TYPES}. */
export const isFileMimeType = (mimeType: string): mimeType is FileMimeType =>
	(FILE_MIME_TYPES as readonly string[]).includes(mimeType);

/**
 * A workspace file as a user's turn references it. `name` is the uploader's
 * file name and untrusted.
 */
export interface WorkspaceFileRef {
	id: string;
	name: string;
	mimeType: FileMimeType;
	/** In bytes. */
	size: number;
}

/** A workspace file of a thread, as the sidecar's listing answers it. */
export interface WorkspaceFile {
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

/**
 * What the file tools of one response may spend, shared by every entry that
 * mounts file tools. Fixed, not configurable.
 */
export const FILE_BUDGETS = {
	reads: 80,
	vision: 12,
	readChars: { default: 20_000, max: 50_000 },
	visionImageBytes: 3.75 * MIB,
} as const;
