// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { attachmentAdapter, deliveredOf, echoParts } from "./attachments.js";

import type { AttachmentLimits } from "../protocol/attachments.js";
import type { PendingAttachment } from "@assistant-ui/react";

const LIMITS: AttachmentLimits = {
	mimeTypes: ["image/png", "application/pdf"],
	maxImageBytes: 3_932_160,
	maxDocumentBytes: 5_242_880,
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
