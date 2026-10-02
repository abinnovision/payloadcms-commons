import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";
import { dossiers } from "../fixtures/security.js";

import type { CallResult, McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-hidden-fields";

const ADMIN_HIDDEN = "value hidden from the admin panel";
const API_HIDDEN = "value hidden from the api";

describe("hidden fields on an exposed collection", () => {
	let booted: Booted;
	let mcp: McpClient;
	let dossierId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [dossiers],
			plugin: { collections: { dossiers: true } },
		});

		const { payload } = booted;
		const dossier = await payload.create({
			collection: "dossiers" as never,
			data: {
				title: "Dossier",
				adminHidden: ADMIN_HIDDEN,
				apiHidden: API_HIDDEN,
			},
		});

		dossierId = dossier.id;

		const { keys } = await seedKeysFor(payload, {
			hidden: { collections: { dossiers: { read: true } } },
		});

		mcp = createMcpClient(booted, keys.hidden);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const reads: [string, () => Promise<CallResult>][] = [
		[
			"getDocument",
			() => mcp.call("getDocument", { collection: "dossiers", id: dossierId }),
		],
		[
			"findDocuments",
			() => mcp.call("findDocuments", { collection: "dossiers" }),
		],
	];

	for (const [tool, read] of reads) {
		it(`leaves out a field with hidden: true through ${tool}`, async () => {
			const result = await read();

			expect(result.isError).toBe(false);
			expect(result.text).toContain("Dossier");
			expect(result.text).not.toContain(API_HIDDEN);
		});

		it(`leaves out a field with admin.hidden through ${tool}`, async () => {
			const result = await read();

			expect(result.isError).toBe(false);
			expect(result.text).toContain("Dossier");
			expect(result.text).not.toContain(ADMIN_HIDDEN);
		});
	}
});
