"use agent";

import {
	openDocumentGuidance,
	UNTRUSTED_GUIDANCE,
	usePayload,
} from "@abinnovision/payloadcms-flue/agent";
import { useModel, useTool } from "@flue/runtime";
import * as v from "valibot";

import { useTitleTool } from "../title-tool.js";
import {
	findFile,
	readBytes,
	refusalAsOutput,
	useFileReadTools,
	useReadBudget,
} from "../tools/files.js";
import { usePdfTool } from "../tools/pdf.js";
import { useSheetTool } from "../tools/sheets.js";

export function Editor(): string {
	useModel(process.env["FLUE_MODEL"] ?? "anthropic/claude-haiku-5-5");
	const payload = usePayload({ agent: "editor" });

	useTitleTool();
	const spend = useReadBudget();

	useFileReadTools(payload, spend);
	useSheetTool(payload, spend);
	usePdfTool(payload, spend);
	useTool({
		name: "save_file",
		description:
			"Saves a file the user sent in the thread: images to the media collection, everything else to the documents collection. Pass its id from the turn's files or from list_files.",
		input: v.object({
			file: v.union([v.string(), v.number()]),
			alt: v.optional(
				v.pipe(v.string(), v.description("Alt text, for an image.")),
			),
		}),
		run: async ({ data, signal }) =>
			await refusalAsOutput(async () => {
				const file = await findFile(payload, data.file);
				const image = file.mimeType.startsWith("image/");
				const saved = await payload.upload({
					collection: image ? "media" : "documents",
					filename: file.name,
					mimeType: file.mimeType,
					data: await readBytes(payload, file, { signal }),
					// `media` shows `alt` as the document's title.
					...(image && data.alt ? { fields: { alt: data.alt } } : {}),
				});

				return `Saved ${saved.filename}: ${saved.adminUrl}`;
			}),
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
		"Files the user sent are listed by list_files and read with read_file, read_sheet and read_pdf_page; images and small PDFs also reach you directly. To store one, call save_file with its id. Never pass `file` to createDocument yourself: you cannot send the bytes.",
		UNTRUSTED_GUIDANCE,
		"After your first reply in a conversation, call set_thread_title with a short title for it.",
		openDocumentGuidance(payload.context()),
	]
		.filter((line) => line !== undefined)
		.join(" ");
}
