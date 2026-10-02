import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";
import { bulletins } from "../fixtures/security.js";

import type { CallResult } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-version-access";

const EMBARGOED = "embargoed bulletin text";
const PUBLIC = "public bulletin text";

const textOf = (result: CallResult): string =>
	`${result.text ?? ""} ${result.rpcError?.message ?? ""}`;

/**
 * The document passes its read filter now; its first version, saved while the
 * document was private, would not.
 */
describe("old versions under a filtered read access", () => {
	let booted: Booted;
	let key: string;
	let bulletinId: number | string;
	let oldVersionId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [bulletins],
			plugin: { collections: { bulletins: true } },
		});

		const { payload } = booted;
		const user = await payload.create({
			collection: "users",
			data: { email: "bulletins@example.com", password: "bulletin-secret" },
		});

		const bulletin = await payload.create({
			collection: "bulletins" as never,
			data: { body: EMBARGOED, visibility: "private" },
		});

		await payload.update({
			collection: "bulletins" as never,
			id: bulletin.id,
			data: { body: PUBLIC, visibility: "public" },
		});

		const versions = await payload.findVersions({
			collection: "bulletins" as never,
			where: { parent: { equals: bulletin.id } },
			sort: "createdAt",
		});

		bulletinId = bulletin.id;
		oldVersionId = versions.docs[0]?.id as number | string;

		key = await createKey(payload, {
			userId: user.id,
			label: "bulletins",
			capabilities: { collections: { bulletins: { read: true } } },
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const call = (name: string, args: Record<string, unknown>) =>
		callTool(booted.config, key, name, args, CACHE_KEY);

	it("reads the document as it stands now", async () => {
		const result = await call("getDocument", {
			collection: "bulletins",
			id: bulletinId,
		});

		expect(result.isError).toBe(false);
		expect(result.data["body"]).toBe(PUBLIC);
	});

	it.fails("lists a version the read filter would exclude", async () => {
		const result = await call("findVersions", {
			collection: "bulletins",
			id: bulletinId,
		});
		const ids = (
			(result.data["versions"] as { versionId: unknown }[] | undefined) ?? []
		).map((version) => version.versionId);

		expect(ids).not.toContain(oldVersionId);
	});

	it.fails("reads a version the read filter would exclude", async () => {
		const result = await call("getDocument", {
			collection: "bulletins",
			id: bulletinId,
			versionId: oldVersionId,
		});

		expect(result.isError).toBe(true);
		expect(textOf(result)).not.toContain(EMBARGOED);
	});

	it.fails("diffs from a version the read filter would exclude", async () => {
		const result = await call("getDocument", {
			collection: "bulletins",
			id: bulletinId,
			diffFrom: oldVersionId,
		});

		expect(result.isError).toBe(true);
		expect(textOf(result)).not.toContain(EMBARGOED);
	});
});
