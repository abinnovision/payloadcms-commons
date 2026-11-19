import {
	ATTACHMENT_MIME_TYPES,
	attachmentKind,
	bytesToBase64,
	bytesToText,
	isTextMimeType,
	maxBytesOf,
} from "../protocol/attachments.js";

import type { FilesLimits, FlueApi } from "./api.js";
import type {
	AttachmentLimits,
	AttachmentMimeType,
	DeliveredAttachment,
	TextMimeType,
} from "../protocol/attachments.js";
import type {
	AttachmentAdapter,
	CompleteAttachment,
	PendingAttachment,
	ThreadUserMessagePart,
} from "@assistant-ui/react";
import type { FlueConversationMessage } from "@flue/sdk";

export type FilePart = Extract<
	FlueConversationMessage["parts"][number],
	{ type: "file" }
>;

const SHEET =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
type SheetMimeType = typeof SHEET;

const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

const isAllowed = (mimeType: string): mimeType is AttachmentMimeType =>
	(ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType);

// The types by file extension, which browsers report inconsistently or not at all.
const EXTENSION_TYPES: Record<string, TextMimeType | SheetMimeType> = {
	".md": "text/markdown",
	".markdown": "text/markdown",
	".txt": "text/plain",
	".csv": "text/csv",
	".xlsx": SHEET,
};

const extensionOf = (name: string): string => {
	const dot = name.lastIndexOf(".");

	return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

/**
 * The type of a file among the allowed ones: the type of its extension,
 * else the type the browser reports, since browsers report an empty,
 * generic or legacy type for files such as `.md`, `.csv` or `.xlsx`.
 */
export const mimeTypeOf = <T extends string>(
	file: Pick<File, "name" | "type">,
	allowed: readonly T[],
): T | undefined => {
	const byExtension = EXTENSION_TYPES[extensionOf(file.name)];

	return (
		allowed.find((type) => type === byExtension) ??
		allowed.find((type) => type === file.type)
	);
};

// The file picker's filter: the allowed types, and the extensions of the mapped ones.
const acceptOf = (allowed: readonly string[]): string =>
	[
		...allowed,
		...Object.keys(EXTENSION_TYPES).filter((extension) =>
			allowed.includes(EXTENSION_TYPES[extension] ?? ""),
		),
	].join(",");

const mebibytes = (bytes: number): string =>
	`${String(Number((bytes / 1_048_576).toFixed(2)))} MiB`;

const base64 = async (file: File): Promise<string> =>
	bytesToBase64(new Uint8Array(await file.arrayBuffer()));

// Unique within the page; `crypto.randomUUID` needs a secure context.
let attachmentCount = 0;

const refuse = (message: string): Promise<never> =>
	Promise.reject(new Error(message));

/**
 * The composer's attachment adapter for the limits the agents endpoint
 * answers. It mirrors the chat endpoint's checks so a file it would refuse
 * is refused when added; `count` is the number of files already attached.
 * Images become `image` parts with a data URL, documents and text files
 * `file` parts in base64.
 */
export const attachmentAdapter = (
	limits: AttachmentLimits,
	count: () => number,
): AttachmentAdapter => ({
	accept: acceptOf(limits.mimeTypes),

	add: async ({ file }) => {
		const mimeType = mimeTypeOf(file, limits.mimeTypes);

		if (mimeType === undefined) {
			return await refuse(`${file.name} is not a file type the agent takes.`);
		}

		if (count() >= limits.maxFiles) {
			return await refuse(
				`A message takes at most ${String(limits.maxFiles)} files.`,
			);
		}

		const type = attachmentKind(mimeType);
		const max = maxBytesOf(limits, mimeType);

		if (file.size > max) {
			return await refuse(`${file.name} is larger than ${mebibytes(max)}.`);
		}

		if (file.size === 0) {
			return await refuse(`${file.name} is empty.`);
		}

		if (
			isTextMimeType(mimeType) &&
			bytesToText(new Uint8Array(await file.arrayBuffer())) === undefined
		) {
			return await refuse(`${file.name} is not UTF-8 text.`);
		}

		return {
			id: `attachment-${String(++attachmentCount)}`,
			type,
			name: file.name,
			contentType: mimeType,
			file,
			status: { type: "requires-action", reason: "composer-send" },
		};
	},

	send: async (attachment: PendingAttachment): Promise<CompleteAttachment> => {
		const data = await base64(attachment.file);
		const mimeType = attachment.contentType ?? attachment.file.type;

		return {
			...attachment,
			status: { type: "complete" },
			content: [
				attachment.type === "image"
					? {
							type: "image",
							image: `data:${mimeType};base64,${data}`,
							filename: attachment.name,
						}
					: { type: "file", data, mimeType, filename: attachment.name },
			],
		};
	},

	remove: () => Promise.resolve(),
});

// A file in the workspace as an attachment's content, which carries its id.
const FILE_REF = "flue-file:";

/** The content of an attachment that stands for the workspace file `id`. */
export const fileRefPart = (
	id: string,
	name: string,
	mimeType: string,
): ThreadUserMessagePart => ({
	type: "file",
	data: `${FILE_REF}${id}`,
	mimeType,
	filename: name,
});

/** The workspace file id a file part's data stands for, or undefined for any other. */
export const fileRefIdOf = (data: string): string | undefined =>
	data.startsWith(FILE_REF) ? data.slice(FILE_REF.length) : undefined;

const fileIdOf = (
	part: ThreadUserMessagePart | undefined,
): string | undefined =>
	part?.type === "file" ? fileRefIdOf(part.data) : undefined;

/**
 * The composer's attachment adapter for the file workspace. A file is
 * checked against the limits, uploaded as soon as it is added with its
 * progress shown, and sent as its id; removing it deletes the upload, once
 * it finishes when it is still in flight.
 */
export const fileAdapter = (
	limits: FilesLimits,
	count: () => number,
	api: Pick<FlueApi, "deleteFile" | "uploadFile">,
): AttachmentAdapter => {
	// The attachments removed while their upload was in flight.
	const removed = new Set<string>();

	return {
		accept: acceptOf(limits.mimeTypes),

		add: async function* ({ file }) {
			const mimeType = mimeTypeOf(file, limits.mimeTypes);

			if (mimeType === undefined) {
				return await refuse(`${file.name} is not a file type the agent takes.`);
			}

			if (count() >= limits.maxFiles) {
				return await refuse(
					`A message takes at most ${String(limits.maxFiles)} files.`,
				);
			}

			if (file.size > limits.maxBytes) {
				return await refuse(
					`${file.name} is larger than ${mebibytes(limits.maxBytes)}.`,
				);
			}

			if (file.size === 0) {
				return await refuse(`${file.name} is empty.`);
			}

			const base = {
				id: `attachment-${String(++attachmentCount)}`,
				type: mimeType.startsWith("image/") ? "image" : "document",
				name: file.name,
				contentType: mimeType,
				file,
			};
			const progress: number[] = [];
			let wake = (): void => undefined;
			const outcome: { id?: string; error?: unknown; failed?: true } = {};

			// The browser reports an empty type for some files, so the mapped one is sent.
			api
				.uploadFile(
					limits.slug,
					new File([file], file.name, { type: mimeType }),
					(fraction) => {
						progress.push(fraction);
						wake();
					},
				)
				.then(
					(id) => {
						outcome.id = id;

						if (removed.delete(base.id)) {
							void api.deleteFile(limits.slug, id).catch(() => undefined);
						}
					},
					(error: unknown) => {
						removed.delete(base.id);
						outcome.error = error;
						outcome.failed = true;
					},
				)
				.finally(() => {
					wake();
				});

			yield {
				...base,
				status: { type: "running", reason: "uploading", progress: 0 },
			};

			const settled = (): boolean =>
				outcome.id !== undefined || outcome.failed !== undefined;

			while (!settled()) {
				// eslint-disable-next-line no-await-in-loop
				await new Promise<void>((resolve) => {
					wake = resolve;

					if (progress.length > 0 || settled()) {
						resolve();
					}
				});

				const fraction = progress.pop();

				progress.length = 0;

				if (fraction !== undefined && !settled()) {
					yield {
						...base,
						status: {
							type: "running",
							reason: "uploading",
							progress: fraction,
						},
					};
				}
			}

			if (outcome.id === undefined) {
				throw outcome.error;
			}

			yield {
				...base,
				content: [fileRefPart(outcome.id, file.name, mimeType)],
				status: { type: "requires-action", reason: "composer-send" },
			};
		},

		send: (attachment: PendingAttachment): Promise<CompleteAttachment> =>
			Promise.resolve({
				...attachment,
				status: { type: "complete" },
				content: attachment.content ?? [],
			}),

		remove: async (attachment) => {
			const id = fileIdOf(attachment.content?.[0]);

			if (id === undefined) {
				removed.add(attachment.id);
			} else {
				await api.deleteFile(limits.slug, id);
			}
		},
	};
};

/** The workspace files of a sent message as the `file` parts of its optimistic echo. */
export const echoReferences = (
	attachments: readonly CompleteAttachment[],
): FilePart[] =>
	attachments.flatMap((attachment) =>
		attachment.content.flatMap((part): FilePart[] =>
			part.type === "file" && fileRefIdOf(part.data) !== undefined
				? [
						{
							type: "file",
							mediaType: part.mimeType,
							url: part.data,
							...(part.filename === undefined
								? {}
								: { filename: part.filename }),
						},
					]
				: [],
		),
	);

/** The ids of the workspace files of a sent message. */
export const fileIdsOf = (
	attachments: readonly CompleteAttachment[],
): string[] =>
	attachments.flatMap((attachment) => fileIdOf(attachment.content[0]) ?? []);

// The kinds of file a drop takes, in the order the hint names them.
const KINDS: ReadonlyArray<readonly [string, (mimeType: string) => boolean]> = [
	["images", (mimeType) => mimeType.startsWith("image/")],
	["PDFs", (mimeType) => mimeType === "application/pdf"],
	["text files", (mimeType) => mimeType.startsWith("text/")],
	["spreadsheets", (mimeType) => mimeType === SHEET],
];

/** The limits a drop reads: the inline attachments' or the file workspace's. */
export type Attachable = Pick<AttachmentLimits, "maxFiles"> & {
	mimeTypes: readonly string[];
};

/** What a drop on the chat takes, such as "Images and PDFs, up to 4 per message". */
export const dropHint = (limits: Attachable): string => {
	const kinds = KINDS.filter(([, matches]) =>
		limits.mimeTypes.some(matches),
	).map(([name]) => name);
	const listed =
		kinds.length > 1
			? `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1) ?? ""}`
			: (kinds[0] ?? "files");
	const files =
		limits.maxFiles === 1
			? "one per message"
			: `up to ${String(limits.maxFiles)} per message`;

	return `${listed.charAt(0).toUpperCase()}${listed.slice(1)}, ${files}`;
};

const delivered = (
	mimeType: string,
	data: string,
	filename: string | undefined,
): DeliveredAttachment[] =>
	isAllowed(mimeType)
		? [
				{
					type: attachmentKind(mimeType),
					data,
					mimeType,
					...(filename === undefined ? {} : { filename }),
				},
			]
		: [];

/** The files of a sent message in the shape the chat endpoint takes. */
export const deliveredOf = (
	attachments: readonly CompleteAttachment[],
): DeliveredAttachment[] =>
	attachments.flatMap((attachment) =>
		attachment.content.flatMap((part) => {
			if (part.type === "image") {
				const [, mimeType = "", data = ""] = DATA_URL.exec(part.image) ?? [];

				return delivered(mimeType, data, part.filename);
			}

			// A workspace file goes by its id, not inline.
			return part.type === "file" && fileRefIdOf(part.data) === undefined
				? delivered(part.mimeType, part.data, part.filename)
				: [];
		}),
	);

/** Delivered files as the `file` parts of a message's optimistic echo. */
export const echoParts = (
	attachments: readonly DeliveredAttachment[],
): FilePart[] =>
	attachments.map(({ data, mimeType, filename }) => ({
		type: "file",
		mediaType: mimeType,
		url: `data:${mimeType};base64,${data}`,
		...(filename === undefined ? {} : { filename }),
	}));
