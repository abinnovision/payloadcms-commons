import { describe, expect, it } from "vitest";

import { contextOf } from "./context.js";
import {
	CONTEXT_SIGNAL_TYPE,
	encodeContext,
	userTurnBody,
} from "../protocol/context.js";

import type { ChatContext } from "../protocol/context.js";

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
