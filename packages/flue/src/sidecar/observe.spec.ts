import { describe, expect, it } from "vitest";

import { observeStream, reconciliationOf } from "./observe.js";
import { fixture, fixtureJson } from "../../test/builders/fixtures.js";

import type {
	ConversationResetChunk,
	FlueHistory,
	FlueStreamEvent,
} from "../protocol/events.js";

const RECORDING = Buffer.from(fixture("flue-updates.sse"));

// The recording's chunks as one JSON page, as Flue answers a read without `live=sse`.
const PAGE = Buffer.from(
	JSON.stringify(
		RECORDING.toString("utf8")
			.split("\n\n")
			.filter((block) => block.startsWith("event: data\n"))
			.flatMap(
				(block) =>
					JSON.parse(block.slice("event: data\ndata:".length)) as unknown[],
			),
	),
);

// Streams `chunks` through the observer and collects what comes out.
const observe = async (
	chunks: Uint8Array[],
	onEvent: (event: FlueStreamEvent) => unknown,
	onError: (error: unknown) => void = () => undefined,
	format: "json" | "sse" = "sse",
): Promise<Buffer> => {
	const source = new ReadableStream<Uint8Array>({
		start: (controller) => {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}

			controller.close();
		},
	});
	const out: Uint8Array[] = [];

	for await (const chunk of source.pipeThrough(
		observeStream(onEvent, onError, format),
	)) {
		out.push(chunk);
	}

	return Buffer.concat(out);
};

const byteByByte = (bytes: Buffer): Uint8Array[] =>
	[...bytes].map((byte) => Uint8Array.of(byte));

// Cuts right after each blank line that ends an event.
const atEventBoundaries = (bytes: Buffer): Uint8Array[] => {
	const text = bytes.toString("utf8");
	const events = text.split(/(?<=\n\n)/);

	return events.map((event) => new TextEncoder().encode(event));
};

// The title part and the settlement, which are what the thread row follows.
const tracked = (events: FlueStreamEvent[]): string[] =>
	events.flatMap((event) => {
		if (event.type === "data-part") {
			return [`title:${String(event.data)}`];
		}

		return event.type === "submission-settled"
			? [`settled:${event.submissionId}:${event.outcome}`]
			: [];
	});

describe("observeStream", () => {
	it.each([
		["one byte at a time", byteByByte],
		["at event boundaries", atEventBoundaries],
	])(
		"passes the recording through unchanged, fed %s",
		async (_label, split) => {
			const events: FlueStreamEvent[] = [];
			const out = await observe(split(RECORDING), (event) => {
				events.push(event);
			});

			expect(out.equals(RECORDING)).toBe(true);
			expect(tracked(events)).toEqual([
				"title:Secret word lookup",
				"settled:sub_01M6VB02GCSHGD7X1Z5829HF5Q:completed",
			]);
		},
	);

	it("passes a JSON page through unchanged and reads its chunks in order", async () => {
		const events: FlueStreamEvent[] = [];
		const out = await observe(
			byteByByte(PAGE),
			(event) => {
				events.push(event);
			},
			undefined,
			"json",
		);

		expect(out.equals(PAGE)).toBe(true);
		expect(tracked(events)).toEqual([
			"title:Secret word lookup",
			"settled:sub_01M6VB02GCSHGD7X1Z5829HF5Q:completed",
		]);
	});

	it("ends a JSON page only after its handlers are done", async () => {
		const order: string[] = [];
		const observed = new Response(PAGE).body!.pipeThrough(
			observeStream(
				async (event) => {
					if (event.type === "submission-settled") {
						await new Promise((resolve) => {
							setTimeout(resolve, 10);
						});
						order.push("handled");
					}
				},
				() => undefined,
				"json",
			),
		);

		await new Response(observed).text();
		order.push("ended");

		expect(order).toEqual(["handled", "ended"]);
	});

	it("reports a malformed JSON page and passes its bytes through", async () => {
		const malformed = Buffer.from("{not json");
		const errors: unknown[] = [];
		const out = await observe(
			[malformed],
			() => undefined,
			(error) => errors.push(error),
			"json",
		);

		expect(out.equals(malformed)).toBe(true);
		expect(errors).toHaveLength(1);
	});

	it("holds an event's bytes until its handler is done", async () => {
		const order: string[] = [];
		const source = new ReadableStream<Uint8Array>({
			start: (controller) => {
				for (const chunk of atEventBoundaries(RECORDING)) {
					controller.enqueue(chunk);
				}

				controller.close();
			},
		});
		const observed = source.pipeThrough(
			observeStream(
				async (event) => {
					if (event.type === "submission-settled") {
						await new Promise((resolve) => {
							setTimeout(resolve, 10);
						});
						order.push("handled");
					}
				},
				() => undefined,
			),
		);

		for await (const chunk of observed) {
			if (new TextDecoder().decode(chunk).includes("submission-settled")) {
				order.push("passed");
			}
		}

		expect(order).toEqual(["handled", "passed"]);
	});

	it("reports a failing handler and keeps the stream going", async () => {
		const errors: unknown[] = [];
		const out = await observe(
			atEventBoundaries(RECORDING),
			(event) => {
				if (event.type === "data-part") {
					throw new Error("write failed");
				}

				if (event.type === "submission-settled") {
					return Promise.reject(new Error("settle failed"));
				}

				return undefined;
			},
			(error) => errors.push(error),
		);

		expect(out.equals(RECORDING)).toBe(true);
		expect(errors.map((error) => (error as Error).message)).toEqual([
			"write failed",
			"settle failed",
		]);
	});

	it("reports a malformed event and passes its bytes through", async () => {
		const malformed = Buffer.from("event: data\ndata:{not json\n\n");
		const errors: unknown[] = [];
		const out = await observe(
			[malformed, RECORDING],
			() => undefined,
			(error) => errors.push(error),
		);

		expect(out.equals(Buffer.concat([malformed, RECORDING]))).toBe(true);
		expect(errors).toHaveLength(1);
	});
});

describe("reconciliationOf", () => {
	const HISTORY = fixtureJson<FlueHistory>("flue-history.json");
	const SETTLED = HISTORY.settlements[0]!;
	const TITLE = "Secret word lookup";

	// A reset as Flue sends it on a read from -1, around a snapshot with an earlier settlement.
	const reset: ConversationResetChunk = {
		type: "conversation-reset",
		conversationId: HISTORY.conversationId,
		position: { batch: 0, index: 0 },
		snapshot: {
			...HISTORY,
			settlements: [
				{ submissionId: "sub_earlier", outcome: "failed" },
				...HISTORY.settlements,
			],
		},
	};

	it("settles the running submission of the row and applies the agent's title", () => {
		expect(
			reconciliationOf(
				{ id: 1, status: "running", lastSubmissionId: SETTLED.submissionId },
				reset.snapshot,
			),
		).toEqual({ settlement: SETTLED, title: TITLE });
	});

	it("leaves the status of a row that does not run that submission", () => {
		expect(
			reconciliationOf(
				{ id: 1, status: "running", lastSubmissionId: "sub_later" },
				reset.snapshot,
			).settlement,
		).toBeUndefined();
		expect(
			reconciliationOf(
				{ id: 1, status: "idle", lastSubmissionId: SETTLED.submissionId },
				reset.snapshot,
			).settlement,
		).toBeUndefined();
	});

	it("keeps a rename while the agent has written no new title", () => {
		expect(
			reconciliationOf(
				{ id: 1, status: "idle", agentTitle: TITLE },
				reset.snapshot,
			),
		).toEqual({ settlement: undefined, title: undefined });
	});
});
