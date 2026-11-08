import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
	bootPayload,
	RECORDED_SUBMISSION,
	seed,
	send,
	shutdown,
	stored,
	THREADS_SLUG,
} from "./helpers/payload.js";
import { handleHash } from "../../src/threads/handle.js";
import { SIDECAR_SECRET } from "../fixtures/config.js";

import type { Booted, Doc, Seeded } from "./helpers/payload.js";

// The title the recordings carry.
const RECORDED_TITLE = "Secret word lookup";
const OTHER_SUBMISSION = "sub_01M6VB1PKSNJ6YKC0R61XQDYSE";

describe("settledHandler", () => {
	let booted: Booted;
	let seeded: Seeded;

	// A thread of the first user, as the plugin writes it.
	const thread = async (data: Record<string, unknown>): Promise<Doc> =>
		await booted.payload.create({
			collection: THREADS_SLUG,
			data: {
				agent: "editor",
				kind: "reactive",
				title: "Untitled",
				conversationId: randomUUID(),
				handleHash: handleHash(randomUUID()),
				createdBy: { relationTo: "users", value: seeded.first.id },
				status: "running",
				lastSubmissionId: RECORDED_SUBMISSION,
				...data,
			},
			depth: 0,
			overrideAccess: true,
			showHiddenFields: true,
		});

	const poke = (
		body: unknown,
		headers: Record<string, string> = {
			authorization: `Bearer ${SIDECAR_SECRET}`,
		},
	): Promise<Response> =>
		send(booted, "/api/flue/settled", { method: "POST", body, headers });

	const pokeFor = (row: Doc, submissionId = RECORDED_SUBMISSION) =>
		poke({ conversation: row["conversationId"], submissionId });

	beforeAll(async () => {
		booted = await bootPayload("flue-settled");
		seeded = await seed(booted.payload);
	});

	beforeEach(() => {
		booted.sidecar.reset();
		booted.sidecar.requests.length = 0;
	});

	afterAll(async () => {
		await shutdown(booted);
	});

	it("refuses a wrong secret and leaves the row unchanged", async () => {
		const row = await thread({});
		const response = await poke(
			{
				conversation: row["conversationId"],
				submissionId: RECORDED_SUBMISSION,
			},
			{ authorization: "Bearer not-the-secret" },
		);

		expect(response.status).toBe(401);
		expect(booted.sidecar.requests).toEqual([]);
		expect(await stored(booted, row.id)).toMatchObject({
			status: "running",
			title: "Untitled",
		});
	});

	it("settles a running thread from its history and takes the agent's title", async () => {
		const row = await thread({});
		const response = await pokeFor(row);

		expect(response.status).toBe(204);
		expect(booted.sidecar.requests.map((request) => request.path)).toEqual([
			`/agents/editor/${String(row["conversationId"])}?view=history`,
		]);
		expect(await stored(booted, row.id)).toMatchObject({
			status: "idle",
			title: RECORDED_TITLE,
		});
	});

	it("answers 409 until the row records the submission, then settles it", async () => {
		const row = await thread({ lastSubmissionId: OTHER_SUBMISSION });

		expect((await pokeFor(row)).status).toBe(409);
		expect(booted.sidecar.requests).toEqual([]);
		expect(await stored(booted, row.id)).toMatchObject({
			status: "running",
			lastSubmissionId: OTHER_SUBMISSION,
		});

		await booted.payload.update({
			collection: THREADS_SLUG,
			id: row.id,
			data: { lastSubmissionId: RECORDED_SUBMISSION },
			overrideAccess: true,
		});

		expect((await pokeFor(row)).status).toBe(204);
		expect(await stored(booted, row.id)).toMatchObject({ status: "idle" });
	});

	it("answers 204 for an archived thread without reading history", async () => {
		const row = await thread({ status: "archived" });
		const response = await pokeFor(row);

		expect(response.status).toBe(204);
		expect(booted.sidecar.requests).toEqual([]);
		expect(await stored(booted, row.id)).toMatchObject({ status: "archived" });
	});

	it("answers 204 for an unknown conversation without reading history", async () => {
		const response = await poke({
			conversation: randomUUID(),
			submissionId: RECORDED_SUBMISSION,
		});

		expect(response.status).toBe(204);
		expect(booted.sidecar.requests).toEqual([]);
	});

	it.each([
		["no submission", { conversation: "conv-1" }],
		["an empty conversation", { conversation: "", submissionId: "sub_1" }],
		["a number", { conversation: 1, submissionId: "sub_1" }],
		[
			"an over-long id",
			{ conversation: "c".repeat(257), submissionId: "sub_1" },
		],
		["an array", [{ conversation: "conv-1", submissionId: "sub_1" }]],
	])("refuses a body with %s", async (_, body) => {
		expect((await poke(body)).status).toBe(400);
		expect(booted.sidecar.requests).toEqual([]);
	});

	it("refuses a request that is not JSON", async () => {
		const response = await poke("conversation=conv-1", {
			authorization: `Bearer ${SIDECAR_SECRET}`,
			"content-type": "text/plain",
		});

		expect(response.status).toBe(415);
	});

	it("refuses a body over 4 KiB", async () => {
		const response = await poke({
			conversation: "conv-1",
			submissionId: "sub_1",
			padding: "x".repeat(4096),
		});

		expect(response.status).toBe(413);
	});
});
