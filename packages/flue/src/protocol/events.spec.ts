import { createParser } from "eventsource-parser";
import { describe, expect, it } from "vitest";

import { lastTitle, parseStreamEvent, settledOutcome } from "./events.js";
import { fixture, fixtureJson } from "../../test/builders/fixtures.js";

import type {
	FlueHistory,
	FlueStreamEvent,
	SubmissionSettledChunk,
} from "./events.js";

const history = (name: string): FlueHistory => fixtureJson<FlueHistory>(name);

// Feeds a recording through the SSE parser the server and the admin use.
const streamEvents = (name: string): FlueStreamEvent[] => {
	const events: FlueStreamEvent[] = [];
	const parser = createParser({
		onEvent: ({ event, data }) => {
			events.push(...parseStreamEvent(event ?? "message", data));
		},
	});

	parser.feed(fixture(name));

	return events;
};

const settled = (name: string): SubmissionSettledChunk => {
	const chunk = streamEvents(name).find(
		(event) => event.type === "submission-settled",
	);

	if (chunk?.type !== "submission-settled") {
		throw new Error(`${name} has no settled chunk.`);
	}

	return chunk;
};

describe("parseStreamEvent", () => {
	it("parses every chunk of a turn in order, ending with the settlement", () => {
		const chunks = streamEvents("flue-updates.sse").filter(
			(event) => event.type !== "control",
		);

		expect(chunks.map((chunk) => chunk.type)).toEqual([
			"stream-checkpoint",
			"message-appended",
			"message-started",
			"tool-input",
			"message-completed",
			"data-part",
			"tool-output",
			"message-started",
			"message-delta",
			"message-delta",
			"message-completed",
			"submission-settled",
		]);
		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "data-part",
				name: "title",
				data: "Secret word lookup",
			}),
		);
		expect(chunks.at(-1)).toMatchObject({
			submissionId: "sub_01M6VB02GCSHGD7X1Z5829HF5Q",
			outcome: "completed",
		});
	});

	it("reads the resume offset from control events", () => {
		const controls = streamEvents("flue-updates.sse").filter(
			(event) => event.type === "control",
		);

		expect(controls.at(-1)).toEqual({
			type: "control",
			streamNextOffset: "0000000000000000_0000000000000016",
			upToDate: true,
		});
	});

	it("treats a control event without upToDate as behind", () => {
		expect(parseStreamEvent("control", '{"streamNextOffset":"-1"}')).toEqual([
			{ type: "control", streamNextOffset: "-1", upToDate: false },
		]);
	});

	it("skips unknown event names and chunk types", () => {
		expect(parseStreamEvent("message", "[]")).toEqual([]);
		expect(
			parseStreamEvent(
				"data",
				'[{"type":"future-chunk"},{"type":"stream-checkpoint","incarnation":"inc_1"}]',
			),
		).toEqual([{ type: "stream-checkpoint", incarnation: "inc_1" }]);
	});

	it("refuses malformed data", () => {
		expect(() => parseStreamEvent("data", '{"type":"message-delta"}')).toThrow(
			TypeError,
		);
		expect(() => parseStreamEvent("control", "{}")).toThrow(TypeError);
		expect(() => parseStreamEvent("data", "not json")).toThrow(SyntaxError);
	});
});

describe("settledOutcome", () => {
	it("maps completed, failed and aborted to idle, failed and idle", () => {
		expect(
			[
				"flue-updates.sse",
				"flue-updates-failed.sse",
				"flue-updates-aborted.sse",
			].map((name) => settledOutcome(settled(name))),
		).toEqual(["idle", "failed", "idle"]);
	});
});

describe("lastTitle", () => {
	it("returns the title the agent wrote", () => {
		expect(lastTitle(history("flue-history.json"))).toBe("Secret word lookup");
	});

	it("returns nothing when no title was written", () => {
		expect(lastTitle(history("flue-history-running.json"))).toBeUndefined();
	});
});
