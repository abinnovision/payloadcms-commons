import { describe, expect, it } from "vitest";

import {
	TURN_ATTRIBUTE,
	decodeContext,
	encodeContext,
	isUserTurn,
} from "./context.js";

import type { ChatContext } from "./context.js";

const full: ChatContext = {
	route: "/admin/collections/pages/12",
	collection: "pages",
	id: "12",
	global: "settings",
	locale: "de",
	updatedAt: "2026-11-07T10:00:00.000Z",
	kind: "reactive",
	onBehalfOf: "3",
};

describe("encodeContext", () => {
	it("never marks the attributes as a user's turn", () => {
		expect(encodeContext(full)).not.toHaveProperty(TURN_ATTRIBUTE);
	});

	it("leaves unset values out of the attributes", () => {
		expect(encodeContext({ collection: "pages", id: "12" })).toEqual({
			collection: "pages",
			id: "12",
		});
	});
});

describe("decodeContext", () => {
	it("round-trips a context through signal attributes", () => {
		expect(decodeContext(encodeContext(full))).toEqual(full);
	});

	it("ignores unknown attributes and values that are not strings", () => {
		expect(
			decodeContext({ collection: "pages", id: 12, theme: "dark" }),
		).toEqual({ collection: "pages" });
	});

	it("ignores a kind outside the run kinds", () => {
		expect(decodeContext({ kind: "manual", locale: "en" })).toEqual({
			locale: "en",
		});
	});
});

describe("isUserTurn", () => {
	it("accepts attributes carrying the user turn marker", () => {
		expect(isUserTurn({ ...encodeContext(full), turn: "user" })).toBe(true);
	});

	it("refuses attributes without the marker or with another value", () => {
		expect(isUserTurn(encodeContext(full))).toBe(false);
		expect(isUserTurn({ turn: "agent" })).toBe(false);
	});
});
