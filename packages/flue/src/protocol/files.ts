/**
 * A file a user's turn carries, as the agent reads it back. `name` is the
 * uploader's and untrusted.
 */
export interface FileRef {
	/** The upload collection the file is stored in. */
	collection: string;
	/** The Payload id as text. */
	id: string;
	name: string;
	mimeType: string;
	/** In bytes. */
	size: number;
	/** Whether the file also reached the model as a Flue attachment. */
	attached: boolean;
}

/** The turn attribute listing the files, `id|mimeType|size|name` joined by `; `. */
export const FILES_ATTRIBUTE = "files";

/** The turn attribute naming the files' upload collection. */
export const FILES_COLLECTION_ATTRIBUTE = "filesCollection";

/** The turn attribute listing the ids of the attached files, joined by `;`. */
export const ATTACHED_ATTRIBUTE = "attached";

/**
 * The header the agent sends its handle in on every request to Payload, so
 * Payload scopes its file reads to the conversation's thread.
 */
export const FILE_HANDLE_HEADER = "x-flue-handle";

const NAME_MAX = 120;

/** Whether the string reads as an exact `type/subtype` MIME type. */
export const isMimeType = (mimeType: string): boolean =>
	/^[\w.+-]+\/[\w.+-]+$/.test(mimeType);

/** Whether an id can be written into a turn's refs. */
export const isRefId = (id: string): boolean => id !== "" && !/[|;]/.test(id);

// Without parameters; anything that is not a MIME type then reads as bytes.
const refMimeType = (mimeType: string): string => {
	const [type = ""] = mimeType.split(";");
	const trimmed = type.trim().toLowerCase();

	return isMimeType(trimmed) ? trimmed : "application/octet-stream";
};

/** A file name without the characters Flue escapes, the separators and control characters. */
export const refName = (name: string): string =>
	// eslint-disable-next-line no-control-regex
	name.replace(/[&<>"'|;\u0000-\u001f\u007f]/g, "").slice(0, NAME_MAX);

/**
 * The turn attributes of `files`, empty without files. Values hold none of
 * the characters Flue escapes in signal attributes. Throws for an id that
 * {@link isRefId} refuses.
 */
export const fileAttributes = (
	collection: string,
	files: readonly Omit<FileRef, "collection">[],
): Record<string, string> => {
	if (files.length === 0) {
		return {};
	}

	for (const file of files) {
		if (!isRefId(file.id)) {
			throw new Error(
				`[payloadcms-flue] File id "${file.id}" cannot be referenced in a turn.`,
			);
		}
	}

	const attached = files.filter((file) => file.attached);

	return {
		[FILES_ATTRIBUTE]: files
			.map(
				(file) =>
					`${file.id}|${refMimeType(file.mimeType)}|${String(Math.max(0, Math.floor(file.size)))}|${refName(file.name)}`,
			)
			.join("; "),
		[FILES_COLLECTION_ATTRIBUTE]: collection,
		...(attached.length > 0
			? { [ATTACHED_ATTRIBUTE]: attached.map((file) => file.id).join(";") }
			: {}),
	};
};

/** The files of turn attributes written by {@link fileAttributes}. */
export const readFileAttributes = (
	attributes: Readonly<Record<string, unknown>>,
): FileRef[] => {
	const value = attributes[FILES_ATTRIBUTE];
	const collection = attributes[FILES_COLLECTION_ATTRIBUTE];
	const attachedValue = attributes[ATTACHED_ATTRIBUTE];

	if (typeof value !== "string" || typeof collection !== "string") {
		return [];
	}

	const attached = new Set(
		typeof attachedValue === "string" ? attachedValue.split(";") : [],
	);

	return value.split("; ").flatMap((entry): FileRef[] => {
		const [id = "", mimeType = "", size = "", name, ...rest] = entry.split("|");

		return name === undefined ||
			rest.length > 0 ||
			!isRefId(id) ||
			!isMimeType(mimeType) ||
			!/^\d+$/.test(size)
			? []
			: [
					{
						collection,
						id,
						name,
						mimeType,
						size: Number(size),
						attached: attached.has(id),
					},
				];
	});
};
