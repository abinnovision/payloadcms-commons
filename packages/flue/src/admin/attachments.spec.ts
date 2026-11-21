// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import {
	dropHint,
	echoReferences,
	fileAdapter,
	fileIdsOf,
	fileRefPart,
	mimeTypeOf,
	uploadRefOf,
} from "./attachments.js";

import type { AgentFiles } from "./api.js";
import type { PendingAttachment } from "@assistant-ui/react";

const fileOf = (name: string, type: string, text: string): File =>
	new File([text], name, { type });

const TEXT_TYPES = ["text/markdown", "text/plain", "text/csv"];

describe("mimeTypeOf", () => {
	it("takes a type a wildcard admits and keeps the file's own type", () => {
		expect(mimeTypeOf({ name: "a.png", type: "image/png" }, ["image/*"])).toBe(
			"image/png",
		);
		expect(mimeTypeOf({ name: "notes.md", type: "" }, ["text/*"])).toBe(
			"text/markdown",
		);
		expect(
			mimeTypeOf({ name: "a.pdf", type: "application/pdf" }, ["image/*"]),
		).toBeUndefined();
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
		expect(mimeTypeOf({ name, type }, TEXT_TYPES)).toBe(expected);
	});

	it("takes no extension outside the allowed types", () => {
		expect(
			mimeTypeOf({ name: "notes.md", type: "" }, ["text/plain"]),
		).toBeUndefined();
		expect(mimeTypeOf({ name: "notes", type: "" }, TEXT_TYPES)).toBe(undefined);
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
		[["application/zip"], 3, "Files, up to 3 per message"],
		[
			["application/pdf", "application/zip"],
			3,
			"PDFs and other files, up to 3 per message",
		],
	] as const)("names %j with %i files", (mimeTypes, maxFiles, hint) => {
		expect(dropHint({ mimeTypes: [...mimeTypes], maxFiles })).toBe(hint);
	});
});

describe("uploadRefOf", () => {
	it("round-trips a collection and an id through a file part", () => {
		const part = fileRefPart(
			{ collection: "uploads", id: "6743f0c1/x" },
			"a.pdf",
			"application/pdf",
		);

		expect(part.type === "file" && uploadRefOf(part.data)).toEqual({
			collection: "uploads",
			id: "6743f0c1/x",
		});
	});

	it("reads no reference from other data", () => {
		expect(uploadRefOf("data:text/plain;base64,YQ==")).toBeUndefined();
		expect(uploadRefOf("flue-file:12")).toBeUndefined();
	});
});

describe("fileAdapter", () => {
	const FILES: AgentFiles = {
		collection: "uploads",
		mimeTypes: ["application/pdf", "text/markdown", "text/csv"],
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
			content: [
				{ type: "file", data: "flue-file:uploads/12", filename: "brief.pdf" },
			],
		});
		expect(api.uploadFile).toHaveBeenCalledWith(
			"uploads",
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

		expect(api.deleteFile).toHaveBeenCalledWith("uploads", "12");

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

		expect(api.deleteFile).toHaveBeenCalledWith("uploads", "12");
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
		expect(echoReferences([sent])).toEqual([
			{
				type: "file",
				mediaType: "text/csv",
				url: "flue-file:uploads/31",
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
