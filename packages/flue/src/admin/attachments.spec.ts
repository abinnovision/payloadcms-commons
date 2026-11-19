// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import {
	attachmentAdapter,
	deliveredOf,
	dropHint,
	echoParts,
	echoReferences,
	fileAdapter,
	fileIdsOf,
	mimeTypeOf,
} from "./attachments.js";

import type { FilesLimits } from "./api.js";
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

describe("fileAdapter", () => {
	const FILES: FilesLimits = {
		slug: "flue-files",
		mimeTypes: ["application/pdf", "text/markdown", "text/csv"],
		maxBytes: 1024,
		maxFiles: 2,
	};

	// An upload the test settles itself, reporting progress on the way.
	const upload = () => {
		let progress: (fraction: number) => void = () => undefined;
		let finish: (id: string) => void = () => undefined;
		let fail: (error: Error) => void = () => undefined;
		const uploadFile = vi.fn(
			(_slug: string, _file: File, onProgress: (fraction: number) => void) =>
				new Promise<string>((resolve, reject) => {
					progress = onProgress;
					finish = resolve;
					fail = reject;
				}),
		);
		const deleteFile = vi.fn(() => Promise.resolve());

		return {
			uploadFile,
			deleteFile,
			progress: (fraction: number) => {
				progress(fraction);
			},
			finish: (id: string) => {
				finish(id);
			},
			fail: (error: Error) => {
				fail(error);
			},
		};
	};

	const added = (api: ReturnType<typeof upload>, file: File, count = 0) =>
		fileAdapter(FILES, () => count, api).add({ file }) as AsyncGenerator<
			PendingAttachment,
			void
		>;

	it("uploads at once, yields the progress, and ends holding the id", async () => {
		const api = upload();
		const states = added(api, fileOf("brief.pdf", "application/pdf", "%PDF-1"));

		expect((await states.next()).value?.status).toEqual({
			type: "running",
			reason: "uploading",
			progress: 0,
		});

		const next = states.next();

		api.progress(0.4);
		expect((await next).value?.status).toEqual({
			type: "running",
			reason: "uploading",
			progress: 0.4,
		});

		const last = states.next();

		api.finish("12");

		const done = (await last).value!;

		expect(done).toMatchObject({
			name: "brief.pdf",
			type: "document",
			contentType: "application/pdf",
			status: { type: "requires-action", reason: "composer-send" },
			content: [{ type: "file", data: "flue-file:12", filename: "brief.pdf" }],
		});
		expect(api.uploadFile).toHaveBeenCalledWith(
			"flue-files",
			expect.any(File),
			expect.any(Function),
		);
	});

	it("sets the type from the extension when the browser sends none", async () => {
		const api = upload();
		const states = added(api, fileOf("notes.md", "", "# Notes"));

		await states.next();

		const sent = api.uploadFile.mock.calls[0]![1];

		expect(sent.type).toBe("text/markdown");
		expect(sent.name).toBe("notes.md");
	});

	it("rejects with the upload's message when it fails", async () => {
		const api = upload();
		const states = added(api, fileOf("brief.pdf", "application/pdf", "%PDF-1"));

		await states.next();

		const next = states.next();

		api.fail(new Error("brief.pdf is larger than the server takes."));

		await expect(next).rejects.toThrow(
			"brief.pdf is larger than the server takes.",
		);
	});

	it("refuses a file before uploading it", async () => {
		const api = upload();

		await expect(
			added(api, fileOf("logo.svg", "image/svg+xml", "<svg/>")).next(),
		).rejects.toThrow("logo.svg is not a file type the agent takes.");
		await expect(
			added(api, fileOf("a.pdf", "application/pdf", "x".repeat(1025))).next(),
		).rejects.toThrow("a.pdf is larger than 0 MiB.");
		await expect(
			added(api, fileOf("a.pdf", "application/pdf", "abc"), 2).next(),
		).rejects.toThrow("A message takes at most 2 files.");
		await expect(
			added(api, fileOf("a.pdf", "application/pdf", "")).next(),
		).rejects.toThrow("a.pdf is empty.");
		expect(api.uploadFile).not.toHaveBeenCalled();
	});

	it("deletes the upload when the attachment is removed", async () => {
		const api = upload();
		const adapter = fileAdapter(FILES, () => 0, api);
		const states = adapter.add({
			file: fileOf("brief.pdf", "application/pdf", "%PDF-1"),
		}) as AsyncGenerator<PendingAttachment, void>;

		await states.next();

		const next = states.next();

		api.finish("12");

		const ready = (await next).value!;

		await adapter.remove(ready);

		expect(api.deleteFile).toHaveBeenCalledWith("flue-files", "12");

		// Nothing was stored for an upload that never finished.
		await adapter.remove({ ...ready, content: [] });
		expect(api.deleteFile).toHaveBeenCalledTimes(1);
	});

	it("deletes an upload once it finishes when removed in flight", async () => {
		const api = upload();
		const adapter = fileAdapter(FILES, () => 0, api);
		const states = adapter.add({
			file: fileOf("brief.pdf", "application/pdf", "%PDF-1"),
		}) as AsyncGenerator<PendingAttachment, void>;
		const uploading = (await states.next()).value!;

		await adapter.remove(uploading);
		expect(api.deleteFile).not.toHaveBeenCalled();

		const next = states.next();

		api.finish("12");
		await next;

		expect(api.deleteFile).toHaveBeenCalledWith("flue-files", "12");
	});

	it("sends the id and echoes the reference", async () => {
		const api = upload();
		const adapter = fileAdapter(FILES, () => 0, api);
		const states = adapter.add({
			file: fileOf("data.csv", "text/csv", "a,b"),
		}) as AsyncGenerator<PendingAttachment, void>;

		await states.next();

		const next = states.next();

		api.finish("31");

		const sent = await adapter.send((await next).value!);

		expect(sent.status).toEqual({ type: "complete" });
		expect(fileIdsOf([sent])).toEqual(["31"]);
		expect(deliveredOf([sent])).toEqual([]);
		expect(echoReferences([sent])).toEqual([
			{
				type: "file",
				mediaType: "text/csv",
				url: "flue-file:31",
				filename: "data.csv",
			},
		]);
	});

	it("offers the extensions of the types it takes in the file picker", () => {
		expect(fileAdapter(FILES, () => 0, upload()).accept).toBe(
			"application/pdf,text/markdown,text/csv,.md,.markdown,.csv",
		);
	});
});

describe("dropHint for the file workspace", () => {
	it("names spreadsheets", () => {
		expect(
			dropHint({
				mimeTypes: [
					"application/pdf",
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				],
				maxFiles: 10,
			}),
		).toBe("PDFs and spreadsheets, up to 10 per message");
	});
});
