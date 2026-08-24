import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool, toolsList } from "./helpers/mcp.js";
import { bootPayload, createKey, USER } from "./helpers/payload.js";

import type { Booted } from "./helpers/payload.js";

const SETTINGS = "site-settings";
const CACHE_KEY = "mcpx-integration-globals";

interface GlobalDoc {
	_status?: string;
	tagline?: null | string;
	title?: null | string;
	updatedAt?: string;
}

describe("globals", () => {
	let booted: Booted;
	let full: string;
	let collectionsOnly: string;

	beforeAll(async () => {
		// Its own cache key: `getPayload` partitions by key, so reusing the
		// default one would silently hand back the collections-only instance.
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				collections: { pages: { read: true, write: true } },
				globals: {
					[SETTINGS]: { read: true, write: true },
					banner: { read: true },
				},
			},
		});

		const user = await booted.payload.create({
			collection: "users",
			data: USER,
		});

		full = await createKey(booted.payload, {
			userId: user.id,
			label: "full",
			capabilities: {
				collections: { pages: { read: true, write: true } },
				globals: { siteSettings: { read: true, write: true } },
			},
		});

		collectionsOnly = await createKey(booted.payload, {
			userId: user.id,
			label: "collections-only",
			capabilities: { collections: { pages: { read: true, write: true } } },
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const call = (name: string, args: Record<string, unknown>, key = full) =>
		callTool(booted.config, key, name, args, CACHE_KEY);

	const readGlobal = (locale = "en"): Promise<GlobalDoc> =>
		booted.payload.findGlobal({
			slug: SETTINGS,
			locale,
			draft: true,
			overrideAccess: true,
		});

	it("lists globals with a single label and no id type", async () => {
		const { data } = await call("listCapabilities", {});
		const globals = data["globals"] as Record<string, unknown>[];

		expect(globals).toHaveLength(1);
		expect(globals[0]).toMatchObject({
			slug: SETTINGS,
			// Payload derives a human label when the global declares none.
			label: "Site Settings",
			description: "Settings shared by every page.",
			read: true,
			write: true,
			drafts: true,
		});
		expect(globals[0]).not.toHaveProperty("idType");
	});

	it("describes a global's schema", async () => {
		const { data } = await call("describeSchema", { global: SETTINGS });
		const [node] = data as unknown as {
			fields: { path: string }[];
			global?: string;
		}[];

		expect(node?.global).toBe(SETTINGS);
		expect(node).not.toHaveProperty("collection");
		expect(node?.fields.map((field) => field.path)).toEqual([
			"/title",
			"/tagline",
			"/sections",
		]);
	});

	it("patches a global as a draft and leaves the published version alone", async () => {
		const result = await call("patchDocument", {
			global: SETTINGS,
			locale: "en",
			patches: [{ op: "replace", path: "/title", value: "Drafted" }],
		});

		expect(result.isError).toBe(false);
		expect(result.data["global"]).toBe(SETTINGS);
		expect(result.data["id"]).toBeUndefined();
		expect(result.data["status"]).toBe("draft");

		expect((await readGlobal()).title).toBe("Drafted");

		const published = (await booted.payload.findGlobal({
			slug: SETTINGS,
			draft: false,
			overrideAccess: true,
		})) as GlobalDoc;

		expect(published.title ?? null).not.toBe("Drafted");
	});

	it("reports the fields that still block publishing", async () => {
		const { data } = await call("validateDocument", {
			global: SETTINGS,
			locale: "en",
		});
		const blockers = data["publishBlockers"] as { path: string }[];

		// `title` was filled by the patch above; `tagline` is still empty.
		expect(blockers.map((blocker) => blocker.path)).toContain("/tagline");
		expect(data["global"]).toBe(SETTINGS);
	});

	it("keeps locales apart", async () => {
		await call("patchDocument", {
			global: SETTINGS,
			locale: "de",
			patches: [{ op: "replace", path: "/title", value: "Entwurf" }],
		});

		expect((await readGlobal("de")).title).toBe("Entwurf");
		expect((await readGlobal("en")).title).toBe("Drafted");
	});

	it("refuses a stale expectedUpdatedAt", async () => {
		const result = await call("patchDocument", {
			global: SETTINGS,
			locale: "en",
			expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
			patches: [{ op: "replace", path: "/title", value: "Nope" }],
		});

		expect(result.isError).toBe(true);
		expect(result.data["error"]).toMatch(/changed since you read it/);
		expect((await readGlobal()).title).toBe("Drafted");
	});

	it("reads a global without an id", async () => {
		const { data } = await call("getDocument", { global: SETTINGS });

		expect(data["title"]).toBe("Drafted");
		expect(data).not.toHaveProperty("id");
	});

	it("names the offending argument when the target is ambiguous", async () => {
		const both = await call("describeSchema", {
			collection: "pages",
			global: SETTINGS,
		});

		expect(both.isError).toBe(true);
		expect(both.data["error"]).toMatch(/not both/);

		const neither = await call("describeSchema", {});

		expect(neither.isError).toBe(true);
		expect(neither.data["error"]).toMatch(/One of "collection" or "global"/);
	});

	it("refuses an id alongside a global, and a missing one alongside a collection", async () => {
		const withId = await call("getDocument", { global: SETTINGS, id: 1 });

		expect(withId.isError).toBe(true);
		expect(withId.data["error"]).toMatch(/must be omitted.*singleton/);

		const withoutId = await call("getDocument", { collection: "pages" });

		expect(withoutId.isError).toBe(true);
		expect(withoutId.data["error"]).toMatch(/"id" is required/);
	});

	it("rejects a global argument on the collection-only tools", async () => {
		const result = await call("findDocuments", { global: SETTINGS });

		expect(result.isError).toBe(true);
		expect(result.text).toMatch(/global/);
	});

	it("hides a global from a key whose checkbox is unticked", async () => {
		const tools = await toolsList(booted.config, collectionsOnly, CACHE_KEY);
		const describe_ = tools.find((tool) => tool.name === "describeSchema");
		const properties = describe_?.inputSchema["properties"] as Record<
			string,
			unknown
		>;

		expect(properties).not.toHaveProperty("global");

		const result = await call(
			"describeSchema",
			{ global: SETTINGS },
			collectionsOnly,
		);

		expect(result.isError).toBe(true);
	});
});
