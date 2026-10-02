import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient, responseText } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";
import {
	bulletins,
	guardedBulletins,
	openBulletins,
} from "../fixtures/security.js";

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
 * document was private, would not. Version history is off unless an entity
 * sets `versions: true`, and then `access.readVersions` governs old versions.
 */
describe("old versions under a filtered read access", () => {
	let booted: Booted;
	let mcp: McpClient;
	let bulletinsOnly: McpClient;
	let plain: Seeded;
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
			collections: [bulletins, openBulletins, guardedBulletins],
			plugin: {
				collections: {
					bulletins: true,
					"open-bulletins": { versions: true },
					"guarded-bulletins": { versions: true },
				},
			},
		});

		plain = await seedBulletin("bulletins");
		open = await seedBulletin("open-bulletins");
		guarded = await seedBulletin("guarded-bulletins");

		const { keys } = await seedKeysFor(booted.payload, {
			all: {
				collections: {
					bulletins: { read: true },
					openBulletins: { read: true },
					guardedBulletins: { read: true },
				},
			},
			bulletinsOnly: { collections: { bulletins: { read: true } } },
		});

		mcp = createMcpClient(booted, keys.all);
		bulletinsOnly = createMcpClient(booted, keys.bulletinsOnly);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	describe("without versions: true", () => {
		it("reads the document as it stands now", async () => {
			const result = await mcp.call("getDocument", {
				collection: "bulletins",
				id: plain.id,
			});

			expect(result.isError).toBe(false);
			expect(result.data["body"]).toBe(PUBLIC);
		});

		it("does not list a version the read filter would exclude", async () => {
			const result = await mcp.call("findVersions", {
				collection: "bulletins",
				id: plain.id,
			});

			expect(result.isError).toBe(true);
			expect(listedIds(result.data)).not.toContain(plain.oldVersionId);
		});

		it("does not read a version the read filter would exclude", async () => {
			const result = await mcp.call("getDocument", {
				collection: "bulletins",
				id: plain.id,
				versionId: plain.oldVersionId,
			});

			expect(result.isError).toBe(true);
			expect(result.data["error"]).toBe(
				'"bulletins" does not expose version history.',
			);
			expect(responseText(result)).not.toContain(EMBARGOED);
		});

		it("does not diff from a version the read filter would exclude", async () => {
			const result = await mcp.call("getDocument", {
				collection: "bulletins",
				id: plain.id,
				diffFrom: plain.oldVersionId,
			});

			expect(result.isError).toBe(true);
			expect(result.data).not.toHaveProperty("patch");
			expect(responseText(result)).not.toContain(EMBARGOED);
		});

		it("offers no version tool or argument to a key that reaches nothing else", async () => {
			const tools = await bulletinsOnly.list();
			const getDocument = tools.find((tool) => tool.name === "getDocument");

			expect(tools.map((tool) => tool.name)).not.toContain("findVersions");
			expect(getDocument?.inputSchema["properties"]).not.toHaveProperty(
				"versionId",
			);
		});
	});

	describe("with versions: true and the default readVersions", () => {
		it("lists the old version once the document passes its read filter", async () => {
			const result = await mcp.call("findVersions", {
				collection: "open-bulletins",
				id: open.id,
			});

			expect(result.isError).toBe(false);
			expect(listedIds(result.data)).toContain(open.oldVersionId);
		});

		it("reads the old version", async () => {
			const result = await mcp.call("getDocument", {
				collection: "open-bulletins",
				id: open.id,
				versionId: open.oldVersionId,
			});

			expect(result.isError).toBe(false);
			expect(result.data["body"]).toBe(EMBARGOED);
		});

		it("diffs from the old version", async () => {
			const result = await mcp.call("getDocument", {
				collection: "open-bulletins",
				id: open.id,
				diffFrom: open.oldVersionId,
			});

			expect(result.isError).toBe(false);
			expect(result.data).toHaveProperty("patch");
		});
	});

	describe("with versions: true and a readVersions rule", () => {
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
