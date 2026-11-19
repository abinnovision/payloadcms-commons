import { describe, expect, it } from "vitest";

import { attachmentsOf, contextOf, filesOf } from "./context.js";
import { textToBase64 } from "../protocol/attachments.js";
import {
	CONTEXT_SIGNAL_TYPE,
	encodeContext,
	userTurnBody,
} from "../protocol/context.js";

import type { ChatContext } from "../protocol/context.js";
import type { WorkspaceFileRef } from "../protocol/files.js";

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

describe("attachmentsOf", () => {
	const PNG = { type: "image", data: "AA==", mimeType: "image/png" } as const;
	const MARKDOWN = {
		type: "document",
		data: textToBase64("# Checkpoints\n- one"),
		mimeType: "text/markdown",
		filename: "list.md",
	} as const;

	it("answers the text files of the body, then Flue's attachments", () => {
		expect(
			attachmentsOf({
				kind: "user",
				body: userTurnBody(CONTEXT, "Create these", [MARKDOWN]),
				attachments: [PNG],
			}),
		).toEqual([MARKDOWN, PNG]);
	});

	it("answers no files for a signal or a body without a preamble", () => {
		expect(
			attachmentsOf({
				kind: "signal",
				type: CONTEXT_SIGNAL_TYPE,
				body: "Hi",
				attributes: encodeContext(CONTEXT),
			}),
		).toEqual([]);
		expect(attachmentsOf({ kind: "user", body: "Hi" })).toEqual([]);
	});
});

describe("filesOf", () => {
	const REFS: WorkspaceFileRef[] = [
		{
			id: "42",
			name: 'briefing "spring"\n/>.pdf',
			mimeType: "application/pdf",
			size: 104_857_600,
		},
		{ id: "7", name: "notes.md", mimeType: "text/markdown", size: 9 },
	];
	const NOTES = {
		type: "document",
		data: textToBase64("# Notes\n"),
		mimeType: "text/markdown",
		filename: "notes.md",
	} as const;
	const signal = (body: string) =>
		({
			kind: "signal",
			type: CONTEXT_SIGNAL_TYPE,
			body,
			attributes: { ...encodeContext(CONTEXT), turn: "user" },
		}) as const;

	it("reads the references of a signal turn and its inlined text", () => {
		const delivery = signal(userTurnBody(CONTEXT, "Read these", [NOTES], REFS));

		expect(filesOf(delivery)).toEqual(REFS);
		expect(attachmentsOf(delivery)).toEqual([NOTES]);
	});

	it("reads the references of a user turn", () => {
		expect(
			filesOf({ kind: "user", body: userTurnBody(CONTEXT, "Hi", [], REFS) }),
		).toEqual(REFS);
	});

	it("answers no files for a plain message or another signal", () => {
		expect(filesOf(signal('Hi <payload-file id="1"/>'))).toEqual([]);
		expect(
			filesOf({
				kind: "signal",
				type: "other",
				body: userTurnBody(CONTEXT, "Hi", [], REFS),
			}),
		).toEqual([]);
	});
});
