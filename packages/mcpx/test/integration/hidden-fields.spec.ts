import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";
import { dossiers } from "../fixtures/security.js";

import type { CallResult } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-hidden-fields";

const ADMIN_HIDDEN = "value hidden from the admin panel";
const API_HIDDEN = "value hidden from the api";

describe("hidden fields on an exposed collection", () => {
	let booted: Booted;
	let key: string;
	let dossierId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [dossiers],
			plugin: { collections: { dossiers: true } },
		});

		const { payload } = booted;
		const user = await payload.create({
			collection: "users",
			data: { email: "hidden@example.com", password: "hidden-secret" },
		});

		const dossier = await payload.create({
			collection: "dossiers" as never,
			data: {
				title: "Dossier",
				adminHidden: ADMIN_HIDDEN,
				apiHidden: API_HIDDEN,
			},
		});

		dossierId = dossier.id;

		key = await createKey(payload, {
			userId: user.id,
			label: "hidden",
			capabilities: { collections: { dossiers: { read: true } } },
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const reads: [string, () => Promise<CallResult>][] = [
		[
			"getDocument",
			() =>
				callTool(
					booted.config,
					key,
					"getDocument",
					{ collection: "dossiers", id: dossierId },
					CACHE_KEY,
				),
		],
		[
			"findDocuments",
			() =>
				callTool(
					booted.config,
					key,
					"findDocuments",
					{ collection: "dossiers" },
					CACHE_KEY,
				),
		],
	];

	for (const [tool, read] of reads) {
		it(`leaves out a field with hidden: true through ${tool}`, async () => {
			const result = await read();

			expect(result.isError).toBe(false);
			expect(result.text).toContain("Dossier");
			expect(result.text).not.toContain(API_HIDDEN);
		});

		it.fails(`returns a field with admin.hidden through ${tool}`, async () => {
			const result = await read();

			expect(result.isError).toBe(false);
			expect(result.text).toContain("Dossier");
			expect(result.text).not.toContain(ADMIN_HIDDEN);
		});
	}
});
