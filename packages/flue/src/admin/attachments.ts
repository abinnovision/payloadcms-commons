import {
	ATTACHMENT_MIME_TYPES,
	attachmentKind,
	bytesToBase64,
	bytesToText,
	isTextMimeType,
	maxBytesOf,
} from "../protocol/attachments.js";

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
} from "@assistant-ui/react";
import type { FlueConversationMessage } from "@flue/sdk";

type FilePart = Extract<
	FlueConversationMessage["parts"][number],
	{ type: "file" }
>;

const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

const isAllowed = (mimeType: string): mimeType is AttachmentMimeType =>
	(ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType);

// The text types by file extension, which browsers report inconsistently.
const TEXT_EXTENSIONS: Record<string, TextMimeType> = {
	".md": "text/markdown",
	".markdown": "text/markdown",
	".txt": "text/plain",
	".csv": "text/csv",
};

const extensionOf = (name: string): string => {
	const dot = name.lastIndexOf(".");

	return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

/**
 * The type of a file among the allowed ones: the text type of its
 * extension, else the type the browser reports, since browsers report an
 * empty, generic or legacy type for text files such as `.md` or `.csv`.
 */
export const mimeTypeOf = (
	file: Pick<File, "name" | "type">,
	allowed: readonly AttachmentMimeType[],
): AttachmentMimeType | undefined => {
	const byExtension = TEXT_EXTENSIONS[extensionOf(file.name)];

	if (byExtension !== undefined && allowed.includes(byExtension)) {
		return byExtension;
	}

	return allowed.find((type) => type === file.type);
};

// The file picker's filter: the allowed types, and the extensions of the text ones.
const acceptOf = (allowed: readonly AttachmentMimeType[]): string =>
	[
		...allowed,
		...Object.keys(TEXT_EXTENSIONS).filter((extension) =>
			allowed.includes(TEXT_EXTENSIONS[extension] as AttachmentMimeType),
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

// The kinds of file a drop takes, in the order the hint names them.
const KINDS: ReadonlyArray<readonly [string, (mimeType: string) => boolean]> = [
	["images", (mimeType) => mimeType.startsWith("image/")],
	["PDFs", (mimeType) => mimeType === "application/pdf"],
	["text files", (mimeType) => mimeType.startsWith("text/")],
];

/** What a drop on the chat takes, such as "Images and PDFs, up to 4 per message". */
export const dropHint = (limits: AttachmentLimits): string => {
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

			return part.type === "file"
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
