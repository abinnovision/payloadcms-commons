import * as v from "valibot";
import { describe, expect, it } from "vitest";

import {
	addResponseFile,
	filePartSchema,
	finishResponseFiles,
	FlueUploadError,
	startResponseFiles,
	uploadDocument,
} from "./upload.js";

import type { PayloadUpload } from "../protocol/events.js";

const file = (id: number): PayloadUpload => ({
	collection: "files",
	id,
	filename: `file-${String(id)}.txt`,
	mimeType: "text/plain",
	size: 4,
	adminUrl: `https://cms.example.com/admin/collections/files/${String(id)}`,
});

describe("response files", () => {
	it("collects two uploads of one response into one part", () => {
		startResponseFiles("handle-a");
		addResponseFile("handle-a", file(1));

		expect(addResponseFile("handle-a", file(2))).toEqual({
			files: [file(1), file(2)],
		});
		expect(
			v.safeParse(filePartSchema, { files: [file(1), file(2)] }).success,
		).toBe(true);
	});

	it("starts a new response empty", () => {
		startResponseFiles("handle-b");
		addResponseFile("handle-b", file(1));
		startResponseFiles("handle-b");

		expect(addResponseFile("handle-b", file(2))).toEqual({
			files: [file(2)],
		});
	});

	it("drops the list once the response finished and does not start another", () => {
		startResponseFiles("handle-d");
		addResponseFile("handle-d", file(1));
		finishResponseFiles("handle-d");

		expect(addResponseFile("handle-d", file(2))).toEqual({
			files: [file(2)],
		});
		expect(addResponseFile("handle-d", file(3))).toEqual({
			files: [file(3)],
		});
	});

	it("keeps conversations apart", () => {
		startResponseFiles("handle-e");
		startResponseFiles("handle-f");
		addResponseFile("handle-e", file(1));

		expect(addResponseFile("handle-f", file(2))).toEqual({
			files: [file(2)],
		});
	});
});

const TEXT_FILE = {
	collection: "files",
	filename: "a.txt",
	mimeType: "text/plain",
	data: "text",
};

// The error `uploadDocument` rejects with when `createDocument` answers `result`.
const failure = (callTool: () => Promise<unknown>): Promise<unknown> =>
	uploadDocument(
		{
			session: { callTool },
			payloadUrl: "https://cms.example.com",
			mcpPath: "/api/mcpx",
			fetch: () => Promise.resolve(new Response(null, { status: 200 })),
		},
		TEXT_FILE,
	).catch((caught: unknown) => caught);

describe("uploadDocument", () => {
	it("refuses a result without an upload handoff", async () => {
		const error = await failure(() => Promise.resolve({ id: 7 }));

		expect(error).toBeInstanceOf(FlueUploadError);
		expect(String(error)).toContain("mcpx returned no upload handoff.");
	});

	it("refuses an unparsable handoff URL", async () => {
		const error = await failure(() =>
			Promise.resolve({ upload: { url: "not a url", headers: {} } }),
		);

		expect(error).toBeInstanceOf(FlueUploadError);
		expect(String(error)).toContain("unparsable handoff URL");
	});

	it("prefixes a refused call once", async () => {
		const error = await failure(() =>
			Promise.reject(new Error("[payloadcms-flue] mcpx refused.")),
		);

		expect(error).toBeInstanceOf(FlueUploadError);
		expect((error as Error).message).toBe(
			"[payloadcms-flue] Payload refused the upload. mcpx refused.",
		);
	});

	it("refuses a handoff outside the mcpx upload path and sends nothing", async () => {
		const sent: string[] = [];
		const error: unknown = await uploadDocument(
			{
				session: {
					callTool: () =>
						Promise.resolve({
							upload: {
								url: "https://cms.example.com/elsewhere/upload",
								method: "PUT",
								headers: { "x-mcpx-grant": "grant-0123" },
							},
						}),
				},
				payloadUrl: "https://cms.example.com",
				mcpPath: "/api/mcpx",
				fetch: (input) => {
					sent.push(input instanceof Request ? input.url : input.toString());

					return Promise.resolve(new Response(null, { status: 200 }));
				},
			},
			{
				collection: "files",
				filename: "a.txt",
				mimeType: "text/plain",
				data: "text",
			},
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(FlueUploadError);
		expect(String(error)).toContain('outside "/api/mcpx/upload"');
		expect(String(error)).not.toContain("grant-0123");
		expect(sent).toEqual([]);
	});
});
