import { describe, expect, it } from "vitest";

import {
	hasRunningSubmission,
	isSettled,
	shownMessages,
	toThreadMessage,
} from "./convert.js";
import { fixtureJson } from "../../test/builders/fixtures.js";

import type { FlueConversationMessage, FlueConversationState } from "@flue/sdk";

const convert = (conversation: FlueConversationState) =>
	shownMessages(conversation).map(toThreadMessage);

const message = (
	fields: Partial<FlueConversationMessage>,
): FlueConversationMessage => ({
	id: "entry_1",
	role: "assistant",
	purpose: "assistant",
	display: "visible",
	parts: [],
	...fields,
});

const conversationOf = (
	messages: FlueConversationMessage[],
	settlements: FlueConversationState["settlements"] = [],
): FlueConversationState => ({
	conversationId: "conv_1",
	messages,
	settlements,
});

describe("shownMessages and toThreadMessage", () => {
	it("convert a recorded history into a user turn and the answer with its tool call", () => {
		const history = fixtureJson<FlueConversationState>("flue-history.json");

		expect(convert(history)).toEqual([
			{
				id: history.messages[0]!.id,
				createdAt: new Date("2026-11-07T15:45:52.669Z"),
				role: "user",
				content: [{ type: "text", text: "Word?" }],
			},
			{
				id: history.messages[1]!.id,
				createdAt: new Date("2026-11-07T15:45:53.442Z"),
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "toolu_01JpXbuMBY1frGqhRLvZ2qUM",
						toolName: "lookup_word",
						args: {},
						result: { word: "pelican" },
					},
					{ type: "text", text: 'The word is "pelican."' },
				],
			},
		]);
	});

	it("shows a user's turn sent as a dispatch signal as a user message", () => {
		const turn = message({
			id: "entry_turn",
			role: "system",
			purpose: "dispatch",
			display: "hidden",
			signal: {
				tagName: "payload-context",
				attributes: { turn: "user", route: "/admin" },
			},
			parts: [{ type: "text", text: "Publish the page.", state: "done" }],
		});

		expect(convert(conversationOf([turn]))).toEqual([
			{
				id: "entry_turn",
				role: "user",
				content: [{ type: "text", text: "Publish the page." }],
			},
		]);
	});

	it("drops other signals, plain advisories and hidden answers", () => {
		const conversation = conversationOf([
			message({
				role: "system",
				purpose: "dispatch",
				signal: { attributes: { kind: "reactive" } },
				parts: [{ type: "text", text: "context", state: "done" }],
			}),
			message({ role: "system", purpose: "advisory", display: "diagnostic" }),
			message({ display: "hidden" }),
		]);

		expect(convert(conversation)).toEqual([]);
	});

	it("shows a failed or aborted submission as a system message", () => {
		const conversation = conversationOf([
			message({
				id: "entry_failed",
				role: "system",
				purpose: "advisory",
				display: "diagnostic",
				settlement: { outcome: "failed" },
			}),
			message({
				id: "entry_aborted",
				role: "system",
				purpose: "advisory",
				settlement: { outcome: "aborted" },
			}),
		]);

		expect(convert(conversation)).toEqual([
			{
				id: "entry_failed",
				role: "system",
				content: [{ type: "text", text: "The run failed." }],
			},
			{
				id: "entry_aborted",
				role: "system",
				content: [{ type: "text", text: "The run was stopped." }],
			},
		]);
	});

	it("keeps reasoning and data parts, leaving out titles and files", () => {
		const answer = message({
			parts: [
				{ type: "reasoning", text: "Thinking.", state: "done" },
				{ type: "data-title", data: "A title" },
				{ type: "data-preview", data: { id: 3 } },
				{ type: "file", mediaType: "image/png", id: "att_1" },
			],
		});

		expect(toThreadMessage(answer).content).toEqual([
			{ type: "reasoning", text: "Thinking." },
			{ type: "data-preview", data: { id: 3 } },
		]);
	});

	it("keeps the agent's file card as a data part", () => {
		const files = {
			files: [
				{
					collection: "documents",
					id: 4,
					filename: "summary.md",
					mimeType: "text/markdown",
					size: 120,
					adminUrl: "https://cms.example.com/admin/collections/documents/4",
				},
			],
		};

		expect(
			toThreadMessage(
				message({ parts: [{ type: "data-payload-file", data: files }] }),
			).content,
		).toEqual([{ type: "data-payload-file", data: files }]);
	});

	it("shows a user message with files without its context preamble", () => {
		const turn = message({
			id: "entry_user",
			role: "user",
			purpose: "user",
			parts: [
				{
					type: "text",
					text: '<payload-context route="/admin" kind="chat" turn="user"/>\n\nWhat is in these?',
					state: "done",
				},
				{
					type: "file",
					mediaType: "image/png",
					id: "att_image_sub_1_0",
					url: "/api/flue/c/7/attachments/att_image_sub_1_0",
					filename: "chart.png",
				},
				{
					type: "file",
					mediaType: "application/pdf",
					id: "att_document_sub_1_1",
					url: "/api/flue/c/7/attachments/att_document_sub_1_1",
				},
				{ type: "file", mediaType: "image/png" },
			],
		});

		expect(convert(conversationOf([turn]))).toEqual([
			{
				id: "entry_user",
				role: "user",
				content: [{ type: "text", text: "What is in these?" }],
				attachments: [
					{
						id: "att_image_sub_1_0",
						type: "image",
						name: "chart.png",
						contentType: "image/png",
						status: { type: "complete" },
						content: [
							{
								type: "image",
								image: "/api/flue/c/7/attachments/att_image_sub_1_0",
								filename: "chart.png",
							},
						],
					},
					{
						id: "att_document_sub_1_1",
						type: "document",
						name: "Document",
						contentType: "application/pdf",
						status: { type: "complete" },
						content: [
							{
								type: "file",
								data: "/api/flue/c/7/attachments/att_document_sub_1_1",
								mimeType: "application/pdf",
								filename: "Document",
							},
						],
					},
				],
			},
		]);
	});

	it("shows a user message holding only files without a text part", () => {
		const turn = message({
			role: "user",
			purpose: "user",
			parts: [
				{
					type: "text",
					text: '<payload-context turn="user"/>\n\n',
					state: "done",
				},
				{
					type: "file",
					mediaType: "image/png",
					id: "att_1",
					url: "/api/flue/c/7/attachments/att_1",
				},
			],
		});

		expect(toThreadMessage(turn)).toMatchObject({
			content: [],
			attachments: [{ id: "att_1", name: "Image" }],
		});
	});

	it("shows a signal turn starting with a context tag as typed", () => {
		const text = '<payload-context route="/x" turn="user"/>\n\nHello';
		const turn = message({
			role: "system",
			purpose: "dispatch",
			display: "hidden",
			signal: { attributes: { turn: "user" } },
			parts: [{ type: "text", text, state: "done" }],
		});

		expect(toThreadMessage(turn).content).toEqual([{ type: "text", text }]);
	});

	it("marks a failed tool call as an error and leaves a pending one without result", () => {
		const answer = message({
			parts: [
				{
					type: "dynamic-tool",
					toolName: "mcp__payload__findDocuments",
					toolCallId: "call_1",
					state: "output-error",
					input: { collection: "pages" },
					errorText: "Forbidden.",
				},
				{
					type: "dynamic-tool",
					toolName: "mcp__payload__findDocuments",
					toolCallId: "call_2",
					state: "input-available",
					input: "not an object",
				},
			],
		});

		expect(toThreadMessage(answer).content).toEqual([
			{
				type: "tool-call",
				toolCallId: "call_1",
				toolName: "mcp__payload__findDocuments",
				args: { collection: "pages" },
				result: "Forbidden.",
				isError: true,
			},
			{
				type: "tool-call",
				toolCallId: "call_2",
				toolName: "mcp__payload__findDocuments",
				args: {},
			},
		]);
	});

	it("keeps the identity of unchanged messages, so the runtime converts only new ones", () => {
		const history = fixtureJson<FlueConversationState>("flue-history.json");
		const [first, second] = shownMessages(history);
		const next = {
			...history,
			messages: [history.messages[0]!, { ...second! }],
		};
		const [nextFirst, nextSecond] = shownMessages(next);

		expect(nextFirst).toBe(first);
		expect(nextSecond).not.toBe(second);
	});

	it("marks the echo of a message on its way as optimistic, and Flue's own user turns not", () => {
		const turn: Partial<FlueConversationMessage> = {
			role: "user",
			purpose: "user",
			parts: [{ type: "text", text: "Hello", state: "done" }],
		};

		expect(
			toThreadMessage(message({ ...turn, metadata: { isOptimistic: true } })),
		).toMatchObject({ role: "user", metadata: { isOptimistic: true } });
		expect(toThreadMessage(message(turn))).not.toHaveProperty("metadata");
	});
});

describe("hasRunningSubmission and isSettled", () => {
	it("see a settled submission as not running", () => {
		const history = fixtureJson<FlueConversationState>("flue-history.json");

		expect(hasRunningSubmission(history)).toBe(false);
		expect(isSettled(history, "sub_01M6VB02GCSHGD7X1Z5829HF5Q")).toBe(true);
	});

	it("see a submission without a settlement as running", () => {
		const history = fixtureJson<FlueConversationState>(
			"flue-history-running.json",
		);

		expect(hasRunningSubmission(history)).toBe(true);
		expect(isSettled(history, "sub_01M6VB1PKSNJ6YKC0R61XQDYSE")).toBe(false);
	});

	it("see nothing running without a conversation", () => {
		expect(hasRunningSubmission(undefined)).toBe(false);
		expect(isSettled(undefined, "sub_1")).toBe(false);
	});
});
