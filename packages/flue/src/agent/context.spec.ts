import { describe, expect, it } from "vitest";

import { contextOf, filesOf } from "./context.js";
import {
	CONTEXT_SIGNAL_TYPE,
	encodeContext,
	userTurnBody,
} from "../protocol/context.js";
import { fileAttributes } from "../protocol/files.js";

import type { ChatContext } from "../protocol/context.js";
import type { FileRef } from "../protocol/files.js";

const CONTEXT: ChatContext = {
	route: "/admin/collections/posts/12",
	collection: "posts",
	id: "12",
	locale: "de",
	updatedAt: "2026-11-08T10:00:00.000Z",
	kind: "chat",
};

describe("contextOf", () => {
	it("reads the context of a signal turn", () => {
		expect(
			contextOf({
				kind: "signal",
				type: CONTEXT_SIGNAL_TYPE,
				body: "Hello",
				attributes: { ...encodeContext(CONTEXT), turn: "user" },
			}),
		).toEqual(CONTEXT);
	});

	it("reads the same context from the preamble of a user turn", () => {
		expect(
			contextOf({
				kind: "user",
				body: userTurnBody(CONTEXT, "Describe this"),
				attachments: [{ type: "image", data: "AA==", mimeType: "image/png" }],
			}),
		).toEqual(CONTEXT);
	});

	it("returns undefined for a user turn without a preamble", () => {
		expect(
			contextOf({
				kind: "user",
				body: `Hi <${CONTEXT_SIGNAL_TYPE} locale="de"/>`,
			}),
		).toBeUndefined();
	});

	it("returns undefined for a signal of another type", () => {
		expect(
			contextOf({
				kind: "signal",
				type: "other",
				body: "",
				attributes: { locale: "de" },
			}),
		).toBeUndefined();
	});
});

describe("filesOf", () => {
	const REFS: FileRef[] = [
		{
			collection: "uploads",
			id: "42",
			name: "briefing spring.pdf",
			mimeType: "application/pdf",
			size: 104_857_600,
			attached: false,
		},
		{
			collection: "uploads",
			id: "7",
			name: "chart.png",
			mimeType: "image/png",
			size: 9,
			attached: true,
		},
	];
	const files = fileAttributes("uploads", REFS);

	it("reads the files of a signal turn from its attributes", () => {
		expect(
			filesOf({
				kind: "signal",
				type: CONTEXT_SIGNAL_TYPE,
				body: "Read these",
				attributes: { ...encodeContext(CONTEXT), turn: "user", ...files },
			}),
		).toEqual(REFS);
	});

	it("reads the same files from the preamble of a user turn", () => {
		expect(
			filesOf({
				kind: "user",
				body: userTurnBody(CONTEXT, "Hi", files),
				attachments: [{ type: "image", data: "AA==", mimeType: "image/png" }],
			}),
		).toEqual(REFS);
	});

	it("answers no files for a plain message or another signal", () => {
		expect(filesOf({ kind: "user", body: "Hi" })).toEqual([]);
		expect(
			filesOf({
				kind: "signal",
				type: "other",
				body: "Hi",
				attributes: files,
			}),
		).toEqual([]);
	});
});
