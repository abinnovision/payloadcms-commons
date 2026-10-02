import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";
import { diaries } from "../fixtures/security.js";

import type { CallResult } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-user-access";

interface Seeded {
	key: string;
	diaryId: number | string;
	versionId: number | string;
	title: string;
}

const textOf = (result: CallResult): string =>
	`${result.text ?? ""} ${result.rpcError?.message ?? ""}`;

/**
 * The key narrows what its user may do; it never widens it. Two users with
 * different Payload read access must see different documents through the same
 * tools.
 */
describe("keys of users with different read access", () => {
	let booted: Booted;
	let alice: Seeded;
	let bob: Seeded;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [diaries],
			plugin: { collections: { diaries: true } },
		});

		const seed = async (name: string): Promise<Seeded> => {
			const { payload } = booted;
			const user = await payload.create({
				collection: "users",
				data: { email: `${name}@example.com`, password: "diary-secret" },
			});
			const title = `${name}'s private diary`;
			const diary = await payload.create({
				collection: "diaries" as never,
				data: { title: `${title} (first)`, owner: user.id },
			});

			await payload.update({
				collection: "diaries" as never,
				id: diary.id,
				data: { title },
			});

			const versions = await payload.findVersions({
				collection: "diaries" as never,
				where: { parent: { equals: diary.id } },
				sort: "createdAt",
			});

			return {
				key: await createKey(payload, {
					userId: user.id,
					label: name,
					capabilities: { collections: { diaries: { read: true } } },
				}),
				diaryId: diary.id,
				versionId: versions.docs[0]?.id as number | string,
				title,
			};
		};

		alice = await seed("alice");
		bob = await seed("bob");
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const call = (key: string, name: string, args: Record<string, unknown>) =>
		callTool(booted.config, key, name, args, CACHE_KEY);

	it("lists only the documents the key's user may read", async () => {
		for (const [own, other] of [
			[alice, bob],
			[bob, alice],
		] as const) {
			const result = await call(own.key, "findDocuments", {
				collection: "diaries",
			});
			const docs = result.data["docs"] as { id: unknown; title: string }[];

			expect(result.isError).toBe(false);
			expect(docs.map((doc) => doc.id)).toEqual([own.diaryId]);
			expect(textOf(result)).not.toContain(other.title);
		}
	});

	it("reads an own document and refuses another user's", async () => {
		const own = await call(alice.key, "getDocument", {
			collection: "diaries",
			id: alice.diaryId,
		});

		expect(own.isError).toBe(false);
		expect(own.data["title"]).toBe(alice.title);

		const other = await call(alice.key, "getDocument", {
			collection: "diaries",
			id: bob.diaryId,
		});

		expect(other.isError).toBe(true);
		expect(textOf(other)).not.toContain("bob's private diary");
	});

	it("lists an own document's history and refuses another user's", async () => {
		const own = await call(alice.key, "findVersions", {
			collection: "diaries",
			id: alice.diaryId,
		});

		expect(own.isError).toBe(false);
		expect(own.data["totalDocs"]).toBe(2);

		const other = await call(alice.key, "findVersions", {
			collection: "diaries",
			id: bob.diaryId,
		});

		expect(other.isError).toBe(true);
		expect(other.data).not.toHaveProperty("versions");
	});

	it("refuses another user's version, under either document id", async () => {
		for (const id of [alice.diaryId, bob.diaryId]) {
			const result = await call(alice.key, "getDocument", {
				collection: "diaries",
				id,
				versionId: bob.versionId,
			});

			expect(result.isError).toBe(true);
			expect(textOf(result)).not.toContain("bob's private diary");
		}
	});
});
