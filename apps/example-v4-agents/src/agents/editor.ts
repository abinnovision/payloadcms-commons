"use agent";

import { usePayload } from "@abinnovision/payloadcms-flue/agent";
import { useDelivery, useModel, useTool } from "@flue/runtime";
import * as v from "valibot";

import { useTitleTool } from "../title-tool.js";

export function Editor(): string {
	useModel(process.env["FLUE_MODEL"] ?? "anthropic/claude-haiku-5-5");
	const payload = usePayload({ agent: "editor" });
	const delivery = useDelivery();
	const attachments =
		delivery.kind === "user" ? (delivery.attachments ?? []) : [];

	useTitleTool();
	useTool({
		name: "save_attachment",
		description:
			"Saves a file the user attached to their current message: images to the media collection, PDFs to the documents collection. Files from earlier messages are not available; ask the user to attach them again.",
		input: v.object({
			index: v.pipe(v.number(), v.integer(), v.minValue(0)),
			alt: v.optional(
				v.pipe(v.string(), v.description("Alt text, for an image.")),
			),
		}),
		run: async ({ data }) => {
			const file = attachments[data.index];

			if (!file) {
				return `There is no attachment ${String(data.index)} on the current message; it has ${String(attachments.length)}.`;
			}

			const saved = await payload.upload({
				collection: file.type === "image" ? "media" : "documents",
				filename: file.filename ?? `attachment-${String(data.index)}`,
				mimeType: file.mimeType,
				data: Buffer.from(file.data, "base64"),
				// `media` shows `alt` as the document's title.
				...(file.type === "image" && data.alt
					? { fields: { alt: data.alt } }
					: {}),
			});

			return `Saved ${saved.filename}: ${saved.adminUrl}`;
		},
	});
	useTool({
		name: "save_document",
		description:
			"Saves a Markdown file to the documents collection and shows it to the user as a download.",
		input: v.object({
			filename: v.pipe(v.string(), v.regex(/^[\w .-]{1,100}\.md$/)),
			markdown: v.pipe(v.string(), v.minLength(1)),
		}),
		run: async ({ data }) => {
			const file = await payload.upload({
				collection: "documents",
				filename: data.filename,
				mimeType: "text/markdown",
				data: data.markdown,
			});

			return `Saved ${file.filename}: ${file.adminUrl}`;
		},
	});

	return [
		"You help editors work on the content of this Payload CMS site through the Payload tools.",
		"Read a document before you change it, and say what you changed.",
		"Deleting needs an approval in the admin: share the review link and continue once the user confirms it.",
		"When the user asks for a file, write it as Markdown and call save_document.",
		"To store a file the user attached, call save_attachment with its position, counting from 0. Never pass `file` to createDocument yourself: you cannot send the bytes.",
		"After your first reply in a conversation, call set_thread_title with a short title for it.",
	].join(" ");
}
