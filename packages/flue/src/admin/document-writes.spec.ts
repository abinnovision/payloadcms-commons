import { describe, expect, it } from "vitest";

import { finishedCalls, newDocumentWrites } from "./document-writes.js";

import type { FlueConversationMessage } from "@flue/sdk";

type Part = FlueConversationMessage["parts"][number];

const call = (
	toolCallId: string,
	toolName: string,
	input: Record<string, unknown>,
	state:
		| "input-available"
		| "output-available"
		| "output-error" = "output-available",
	output: unknown = { content: [] },
): Part => {
	const part = {
		type: "dynamic-tool",
		toolCallId,
		toolName,
		input,
		state,
		...(state === "output-available" ? { output } : {}),
		...(state === "output-error" ? { errorText: "Refused." } : {}),
	};

	return part as Part;
};

const answer = (...parts: Part[]): FlueConversationMessage => ({
	id: "entry_1",
	role: "assistant",
	purpose: "assistant",
	display: "visible",
	parts,
});

const PAGE = { collection: "pages", id: "12" };

describe("newDocumentWrites", () => {
	it("reports finished patches and publishes of the open document not handled yet", () => {
		const messages = [
			answer(
				call("a", "mcp__payload__patchDocument", {
					collection: "pages",
					id: 12,
				}),
				call("b", "mcp__payload__publishDocument", PAGE),
			),
		];

		expect(newDocumentWrites(messages, new Set(), PAGE)).toEqual(["a", "b"]);
		expect(newDocumentWrites(messages, new Set(["a"]), PAGE)).toEqual(["b"]);
	});

	it("matches a global by its slug", () => {
		const messages = [
			answer(call("a", "mcp__payload__patchDocument", { global: "settings" })),
		];

		expect(
			newDocumentWrites(messages, new Set(), { global: "settings" }),
		).toEqual(["a"]);
	});

	it("ignores reads, other documents, failures and calls still running", () => {
		const messages = [
			answer(
				call("read", "mcp__payload__getDocument", PAGE),
				call("other", "mcp__payload__patchDocument", {
					collection: "pages",
					id: "13",
				}),
				call("posts", "mcp__payload__patchDocument", {
					collection: "posts",
					id: "12",
				}),
				call("failed", "mcp__payload__patchDocument", PAGE, "output-error"),
				call(
					"refused",
					"mcp__payload__patchDocument",
					PAGE,
					"output-available",
					{
						isError: true,
					},
				),
				call("running", "mcp__payload__patchDocument", PAGE, "input-available"),
			),
		];

		expect(newDocumentWrites(messages, new Set(), PAGE)).toEqual([]);
	});

	it("reports nothing without an open document and keeps the write for one", () => {
		const handled = new Set<string>();
		const messages = [answer(call("a", "mcp__payload__patchDocument", PAGE))];

		expect(newDocumentWrites(messages, handled, undefined)).toEqual([]);
		expect(newDocumentWrites(messages, handled, PAGE)).toEqual(["a"]);
	});

	it("reports a call once it finishes", () => {
		const handled = new Set<string>();

		expect(
			newDocumentWrites(
				[
					answer(
						call("a", "mcp__payload__patchDocument", PAGE, "input-available"),
					),
				],
				handled,
				PAGE,
			),
		).toEqual([]);
		expect(
			newDocumentWrites(
				[answer(call("a", "mcp__payload__patchDocument", PAGE))],
				handled,
				PAGE,
			),
		).toEqual(["a"]);
	});
});

describe("finishedCalls", () => {
	it("lists finished calls with or without an error", () => {
		expect(
			finishedCalls([
				answer(
					call("a", "mcp__payload__patchDocument", PAGE),
					call("b", "mcp__payload__patchDocument", PAGE, "output-error"),
					call("c", "mcp__payload__patchDocument", PAGE, "input-available"),
				),
			]),
		).toEqual(["a", "b"]);
	});
});
