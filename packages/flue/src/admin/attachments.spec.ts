// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
	attachmentAdapter,
	deliveredOf,
	dropHint,
	echoParts,
	mimeTypeOf,
} from "./attachments.js";

import type { AttachmentLimits } from "../protocol/attachments.js";
import type { PendingAttachment } from "@assistant-ui/react";

const LIMITS: AttachmentLimits = {
	mimeTypes: ["image/png", "application/pdf"],
	maxImageBytes: 3_932_160,
	maxDocumentBytes: 5_242_880,
	maxTextBytes: 524_288,
	maxFiles: 2,
};

const fileOf = (name: string, type: string, text: string): File =>
	new File([text], name, { type });

const pending = (file: File, count = 0): Promise<PendingAttachment> =>
	attachmentAdapter(LIMITS, () => count).add({
		file,
	}) as Promise<PendingAttachment>;

describe("attachmentAdapter", () => {
	it("accepts the configured types", () => {
		expect(attachmentAdapter(LIMITS, () => 0).accept).toBe(
			"image/png,application/pdf",
		);
	});

	it("refuses a type outside the configured ones", async () => {
		await expect(
			pending(fileOf("logo.svg", "image/svg+xml", "<svg/>")),
		).rejects.toThrow("logo.svg is not a file type the agent takes.");
	});

	it("refuses an image or a PDF over its limit", async () => {
		await expect(
			pending(fileOf("big.png", "image/png", "x".repeat(3_932_161))),
		).rejects.toThrow("big.png is larger than 3.75 MiB.");
		await expect(
			pending(fileOf("big.pdf", "application/pdf", "x".repeat(5_242_881))),
		).rejects.toThrow("big.pdf is larger than 5 MiB.");
	});

	it("refuses a file beyond the most a message takes", async () => {
		await expect(
			pending(fileOf("third.png", "image/png", "abc"), 2),
		).rejects.toThrow("A message takes at most 2 files.");
	});

	it("sends an image as a data URL and a PDF as base64", async () => {
		const adapter = attachmentAdapter(LIMITS, () => 0);
		const image = await adapter.send(
			await pending(fileOf("dot.png", "image/png", "png")),
		);
		const pdf = await adapter.send(
			await pending(fileOf("brief.pdf", "application/pdf", "%PDF-1")),
		);

		expect(image).toMatchObject({
			type: "image",
			name: "dot.png",
			status: { type: "complete" },
			content: [
				{
					type: "image",
					image: `data:image/png;base64,${btoa("png")}`,
					filename: "dot.png",
				},
			],
		});
		expect(pdf).toMatchObject({
			type: "document",
			content: [
				{
					type: "file",
					data: btoa("%PDF-1"),
					mimeType: "application/pdf",
					filename: "brief.pdf",
				},
			],
		});
		expect(deliveredOf([image, pdf])).toEqual([
			{
				type: "image",
				data: btoa("png"),
				mimeType: "image/png",
				filename: "dot.png",
			},
			{
				type: "document",
				data: btoa("%PDF-1"),
				mimeType: "application/pdf",
				filename: "brief.pdf",
			},
		]);
	});
});

describe("text attachments", () => {
	const TEXT: AttachmentLimits = {
		...LIMITS,
		mimeTypes: ["text/markdown", "text/plain", "text/csv"],
	};

	it("accepts the text types and their extensions in the file picker", () => {
		expect(attachmentAdapter(TEXT, () => 0).accept).toBe(
			"text/markdown,text/plain,text/csv,.md,.markdown,.txt,.csv",
		);
	});

	it.each([
		["notes.md", "", "text/markdown"],
		["notes.MD", "text/x-markdown", "text/markdown"],
		["notes.markdown", "application/octet-stream", "text/markdown"],
		["notes.txt", "text/plain", "text/plain"],
		["table.csv", "application/vnd.ms-excel", "text/csv"],
		["table.csv", "text/csv", "text/csv"],
		["table.csv", "text/plain", "text/csv"],
	])("takes %s reported as %j as %s", (name, type, expected) => {
		expect(mimeTypeOf({ name, type }, TEXT.mimeTypes)).toBe(expected);
	});

	it("takes no extension outside the allowed types", () => {
		expect(
			mimeTypeOf({ name: "notes.md", type: "" }, ["text/plain"]),
		).toBeUndefined();
		expect(mimeTypeOf({ name: "notes", type: "" }, TEXT.mimeTypes)).toBe(
			undefined,
		);
	});

	it("sends a text file as a base64 file part of its mapped type", async () => {
		const adapter = attachmentAdapter(TEXT, () => 0);
		const sent = await adapter.send(
			(await adapter.add({
				file: fileOf("a.md", "", "# Hi"),
			})) as PendingAttachment,
		);

		expect(deliveredOf([sent])).toEqual([
			{
				type: "document",
				data: btoa("# Hi"),
				mimeType: "text/markdown",
				filename: "a.md",
			},
		]);
	});

	it("refuses an empty file and a text file that is not UTF-8", async () => {
		const adapter = attachmentAdapter(TEXT, () => 0);

		await expect(
			adapter.add({ file: fileOf("empty.md", "", "") }),
		).rejects.toThrow("empty.md is empty.");
		await expect(
			adapter.add({
				file: new File([new Uint8Array([0x61, 0xff])], "latin.csv"),
			}),
		).rejects.toThrow("latin.csv is not UTF-8 text.");
		await expect(
			adapter.add({ file: fileOf("nul.txt", "text/plain", "a\0b") }),
		).rejects.toThrow("nul.txt is not UTF-8 text.");
	});

	it("refuses a text file over its own limit", async () => {
		await expect(
			attachmentAdapter(TEXT, () => 0).add({
				file: fileOf("big.txt", "text/plain", "x".repeat(524_289)),
			}),
		).rejects.toThrow("big.txt is larger than 0.5 MiB.");
	});
});

describe("dropHint", () => {
	it.each([
		[
			["image/png", "application/pdf"],
			4,
			"Images and PDFs, up to 4 per message",
		],
		[
			["image/png", "application/pdf", "text/markdown", "text/csv"],
			2,
			"Images, PDFs and text files, up to 2 per message",
		],
		[["text/plain"], 1, "Text files, one per message"],
	] as const)("names %j with %i files", (mimeTypes, maxFiles, hint) => {
		expect(dropHint({ ...LIMITS, mimeTypes: [...mimeTypes], maxFiles })).toBe(
			hint,
		);
	});
});

describe("echoParts", () => {
	it("shows delivered files as file parts with data URLs", () => {
		expect(
			echoParts([
				{
					type: "image",
					data: "cG5n",
					mimeType: "image/png",
					filename: "a.png",
				},
				{ type: "document", data: "JVBE", mimeType: "application/pdf" },
			]),
		).toEqual([
			{
				type: "file",
				mediaType: "image/png",
				url: "data:image/png;base64,cG5n",
				filename: "a.png",
			},
			{
				type: "file",
				mediaType: "application/pdf",
				url: "data:application/pdf;base64,JVBE",
			},
		]);
	});
});
