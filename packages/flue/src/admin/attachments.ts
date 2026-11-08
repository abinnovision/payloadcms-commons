import {
	ATTACHMENT_MIME_TYPES,
	attachmentKind,
} from "../protocol/attachments.js";

import type {
	AttachmentLimits,
	AttachmentMimeType,
	DeliveredAttachment,
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

const mebibytes = (bytes: number): string =>
	`${String(Number((bytes / 1_048_576).toFixed(2)))} MiB`;

const base64 = async (file: File): Promise<string> => {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";

	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}

	return btoa(binary);
};

// Unique within the page; `crypto.randomUUID` needs a secure context.
let attachmentCount = 0;

const refuse = (message: string): Promise<never> =>
	Promise.reject(new Error(message));

/**
 * The composer's attachment adapter for the limits the agents endpoint
 * answers. It mirrors the chat endpoint's checks so a file it would refuse
 * is refused when added; `count` is the number of files already attached.
 * Images become `image` parts with a data URL, PDFs `file` parts in base64.
 */
export const attachmentAdapter = (
	limits: AttachmentLimits,
	count: () => number,
): AttachmentAdapter => ({
	accept: limits.mimeTypes.join(","),

	add: ({ file }) => {
		const mimeType = limits.mimeTypes.find((type) => type === file.type);

		if (mimeType === undefined) {
			return refuse(`${file.name} is not a file type the agent takes.`);
		}

		if (count() >= limits.maxFiles) {
			return refuse(
				`A message takes at most ${String(limits.maxFiles)} files.`,
			);
		}

		const type = attachmentKind(mimeType);
		const max =
			type === "image" ? limits.maxImageBytes : limits.maxDocumentBytes;

		if (file.size > max) {
			return refuse(`${file.name} is larger than ${mebibytes(max)}.`);
		}

		return Promise.resolve({
			id: `attachment-${String(++attachmentCount)}`,
			type,
			name: file.name,
			contentType: mimeType,
			file,
			status: { type: "requires-action", reason: "composer-send" },
		});
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
