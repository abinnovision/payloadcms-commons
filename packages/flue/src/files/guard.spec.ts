import { describe, expect, it } from "vitest";

import { guardFiles, isFileGuard } from "./guard.js";

import type { GuardSettings } from "./guard.js";
import type { PayloadRequest } from "payload";

const settings = {
	agents: [],
	threads: { slug: "flue-threads", readAgentRuns: () => false },
	mcpx: {
		apiKeysSlug: "mcpx-api-keys",
		userCollection: "users",
		endpointPath: "/mcpx",
		mcpPath: "/api/mcpx",
	},
	files: {
		collection: "uploads",
		maxFilesPerTurn: 10,
		deliver: () => "reference",
	},
} satisfies GuardSettings;

// A request whose key lookup answers a flue-managed key.
const requestOf = (context: Record<string, unknown>): PayloadRequest =>
	({
		context,
		headers: new Headers(),
		payload: {
			findByID: () => Promise.resolve({ managedBy: "flue:editor" }),
		},
	}) as unknown as PayloadRequest;

const guard = guardFiles(undefined, settings, "read");

describe("guardFiles", () => {
	it("is marked as the thread guard", () => {
		expect(isFileGuard(guard)).toBe(true);
		expect(isFileGuard(() => true)).toBe(false);
	});

	it("leaves a request without mcpx alone", async () => {
		await expect(guard({ req: requestOf({}), slug: "uploads" })).resolves.toBe(
			true,
		);
	});

	it("leaves the in-process mcpx client alone", async () => {
		await expect(
			guard({
				req: requestOf({ mcpx: { capabilities: {} } }),
				slug: "uploads",
			}),
		).resolves.toBe(true);
	});

	it("leaves other collections alone", async () => {
		await expect(
			guard({ req: requestOf({ mcpx: { apiKeyId: 1 } }), slug: "pages" }),
		).resolves.toBe(true);
	});

	it("refuses a flue-managed key without the handle header", async () => {
		await expect(
			guard({ req: requestOf({ mcpx: { apiKeyId: 1 } }), slug: "uploads" }),
		).resolves.toBe(false);
	});

	it("keeps what an existing function refuses", async () => {
		const composed = guardFiles(() => false, settings, "read");

		await expect(
			composed({ req: requestOf({}), slug: "uploads" }),
		).resolves.toBe(false);
	});
});
