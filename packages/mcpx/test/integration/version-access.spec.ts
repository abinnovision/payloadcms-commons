import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient, responseText } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";
import { bulletins, guardedBulletins } from "../fixtures/security.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-version-access";

const EMBARGOED = "embargoed bulletin text";
const PUBLIC = "public bulletin text";

interface Seeded {
	id: number | string;
	oldVersionId: number | string;
}

/**
 * The document passes its read filter now; its first version, saved while the
 * document was private, would not. Version history follows read, and
 * `access.readVersions` governs old versions.
 */
describe("old versions under a filtered read access", () => {
	let booted: Booted;
	let mcp: McpClient;
	let open: Seeded;
	let guarded: Seeded;

	const seedBulletin = async (slug: string): Promise<Seeded> => {
		const { payload } = booted;
		const bulletin = await payload.create({
			collection: slug as never,
			data: { body: EMBARGOED, visibility: "private" },
		});

		await payload.update({
			collection: slug as never,
			id: bulletin.id,
			data: { body: PUBLIC, visibility: "public" },
		});

		const versions = await payload.findVersions({
			collection: slug as never,
			where: { parent: { equals: bulletin.id } },
			sort: "createdAt",
		});

		return {
			id: bulletin.id,
			oldVersionId: versions.docs[0]?.id as number | string,
		};
	};

	const listedIds = (data: Record<string, unknown>): unknown[] =>
		((data["versions"] as { versionId: unknown }[] | undefined) ?? []).map(
			(version) => version.versionId,
		);

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [bulletins, guardedBulletins],
			plugin: {
				collections: {
					bulletins: { write: false },
					"guarded-bulletins": { write: false },
				},
			},
		});

		open = await seedBulletin("bulletins");
		guarded = await seedBulletin("guarded-bulletins");

		const { keys } = await seedKeysFor(booted.payload, {
			all: {
				collections: {
					bulletins: { read: true },
					guardedBulletins: { read: true },
				},
			},
		});

		mcp = createMcpClient(booted, keys.all);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	describe("with the default readVersions", () => {
		it("lists the old version once the document passes its read filter", async () => {
			const result = await mcp.call("findVersions", {
				collection: "bulletins",
				id: open.id,
			});

			expect(result.isError).toBe(false);
			expect(listedIds(result.data)).toContain(open.oldVersionId);
		});

		it("reads the old version", async () => {
			const result = await mcp.call("getDocument", {
				collection: "bulletins",
				id: open.id,
				versionId: open.oldVersionId,
			});

			expect(result.isError).toBe(false);
			expect(result.data["body"]).toBe(EMBARGOED);
		});

		it("diffs from the old version", async () => {
			const result = await mcp.call("getDocument", {
				collection: "bulletins",
				id: open.id,
				diffFrom: open.oldVersionId,
			});

			expect(result.isError).toBe(false);
			expect(result.data).toHaveProperty("patch");
		});
	});

	describe("with a readVersions rule", () => {
		it("leaves out a version the rule excludes", async () => {
			const result = await mcp.call("findVersions", {
				collection: "guarded-bulletins",
				id: guarded.id,
			});

			expect(result.isError).toBe(false);
			expect(listedIds(result.data)).not.toContain(guarded.oldVersionId);
		});

		it("refuses to read a version the rule excludes", async () => {
			const result = await mcp.call("getDocument", {
				collection: "guarded-bulletins",
				id: guarded.id,
				versionId: guarded.oldVersionId,
			});

			expect(result.isError).toBe(true);
			expect(responseText(result)).not.toContain(EMBARGOED);
		});

		it("refuses to diff from a version the rule excludes", async () => {
			const result = await mcp.call("getDocument", {
				collection: "guarded-bulletins",
				id: guarded.id,
				diffFrom: guarded.oldVersionId,
			});

			expect(result.isError).toBe(true);
			expect(result.data).not.toHaveProperty("patch");
		});
	});
});
