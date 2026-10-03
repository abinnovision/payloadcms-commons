import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectionEnumOf, createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";
import { section } from "../builders/blocks.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-versions";

interface Version {
	versionId: number | string;
	status: null | string;
	latest: boolean;
	autosave: boolean;
}

describe("version history", () => {
	let booted: Booted;
	let editor: McpClient;
	let postsOnly: McpClient;
	let tagsOnly: McpClient;
	let snippetsOnly: McpClient;
	let pageId: number | string;
	let otherPageId: number | string;
	let history: Version[];

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				collections: {
					pages: true,
					posts: { write: false },
					tags: { write: false },
					snippets: true,
				},
				globals: {
					"site-settings": true,
				},
			},
		});

		const { keys } = await seedKeysFor(booted.payload, {
			editor: {
				collections: {
					pages: { read: true, write: true, publish: true },
					snippets: { read: true, write: true },
				},
				globals: { siteSettings: { read: true, write: true, publish: true } },
			},
			postsOnly: { collections: { posts: { read: true } } },
			tagsOnly: { collections: { tags: { read: true } } },
			snippetsOnly: { collections: { snippets: { read: true } } },
		});

		editor = createMcpClient(booted, keys.editor);
		postsOnly = createMcpClient(booted, keys.postsOnly);
		tagsOnly = createMcpClient(booted, keys.tagsOnly);
		snippetsOnly = createMcpClient(booted, keys.snippetsOnly);

		const created = await editor.call("createDocument", {
			collection: "pages",
			locale: "en",
			data: {
				title: "First",
				slug: "first",
				layout: { sections: [section("intro")] },
			},
		});

		pageId = created.data["id"] as number | string;

		for (const title of ["Second", "Third"]) {
			await editor.call("patchDocument", {
				collection: "pages",
				id: pageId,
				locale: "en",
				patches: [{ op: "replace", path: "/title", value: title }],
			});
		}

		await editor.call("publishDocument", { collection: "pages", id: pageId });

		const other = await editor.call("createDocument", {
			collection: "pages",
			locale: "en",
			data: { title: "Other", slug: "other" },
		});

		otherPageId = other.data["id"] as number | string;

		const listed = await editor.call("findVersions", {
			collection: "pages",
			id: pageId,
		});

		history = listed.data["versions"] as Version[];
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("lists a document's versions newest first, without bodies", () => {
		expect(history.map((version) => version.status)).toEqual([
			"published",
			"draft",
			"draft",
			"draft",
		]);
		expect(history[0]).toMatchObject({ latest: true, autosave: false });
		expect(history[0]).not.toHaveProperty("version");
	});

	it("filters by status", async () => {
		const { data } = await editor.call("findVersions", {
			collection: "pages",
			id: pageId,
			status: "published",
		});

		expect(data["totalDocs"]).toBe(1);
	});

	it("reads an old version, and a subtree of it", async () => {
		const oldest = history.at(-1)?.versionId;

		const whole = await editor.call("getDocument", {
			collection: "pages",
			id: pageId,
			locale: "en",
			versionId: oldest,
		});

		expect(whole.isError).toBe(false);
		expect(whole.data["title"]).toBe("First");

		const subtree = await editor.call("getDocument", {
			collection: "pages",
			id: pageId,
			locale: "en",
			versionId: oldest,
			path: "/title",
		});

		expect(subtree.data["value"]).toBe("First");
		expect(subtree.data["id"]).toBe(pageId);
	});

	it("diffs the current draft against the published version", async () => {
		await editor.call("patchDocument", {
			collection: "pages",
			id: pageId,
			locale: "en",
			patches: [{ op: "replace", path: "/title", value: "Fourth" }],
		});

		const result = await editor.call("getDocument", {
			collection: "pages",
			id: pageId,
			locale: "en",
			diffFrom: "published",
		});

		expect(result.isError).toBe(false);
		expect(result.data).toMatchObject({
			from: history[0]?.versionId,
			to: "current",
			patch: [{ op: "replace", path: "/title", value: "Fourth" }],
		});
	});

	it("limits a diff to a path, and finds nothing outside it", async () => {
		const result = await editor.call("getDocument", {
			collection: "pages",
			id: pageId,
			locale: "en",
			diffFrom: "published",
			path: "/layout",
		});

		expect(result.data["patch"]).toEqual([]);
	});

	it("refuses a version of another document", async () => {
		const result = await editor.call("getDocument", {
			collection: "pages",
			id: otherPageId,
			versionId: history[0]?.versionId,
		});

		expect(result.isError).toBe(true);
		expect(result.data["error"]).toMatch(/not found/);
	});

	it("refuses versionId together with draft", async () => {
		const result = await editor.call("getDocument", {
			collection: "pages",
			id: pageId,
			versionId: history[0]?.versionId,
			draft: false,
		});

		expect(result.isError).toBe(true);
		expect(result.data["error"]).toBe(
			'Pass either "versionId" or "draft", not both.',
		);
	});

	it("offers only readable slugs that keep versions", async () => {
		const forEditor = await editor.list();
		const forPostsOnly = await postsOnly.list();
		const forTagsOnly = await tagsOnly.list();

		expect(
			collectionEnumOf(forEditor.find((tool) => tool.name === "findVersions")),
		).toEqual(["pages", "snippets"]);
		expect(
			collectionEnumOf(
				forPostsOnly.find((tool) => tool.name === "findVersions"),
			),
		).toEqual(["posts"]);
		expect(forTagsOnly.map((tool) => tool.name)).not.toContain("findVersions");

		const refused = await postsOnly.call("findVersions", {
			collection: "pages",
			id: pageId,
		});

		expect(refused.isError).toBe(true);
		expect(refused.text).toContain(
			'Invalid input: expected "posts" at collection',
		);
	});

	it("leaves the version arguments out for a key that reaches no exposed versions", async () => {
		const tools = await tagsOnly.list();
		const getDocument = tools.find((tool) => tool.name === "getDocument");
		const properties = getDocument?.inputSchema["properties"] as Record<
			string,
			unknown
		>;

		expect(properties).not.toHaveProperty("versionId");
		expect(properties).not.toHaveProperty("diffFrom");
		expect(getDocument?.description).not.toContain("versionId");
	});

	it("offers status only where a reachable entity has drafts", async () => {
		const statusOf = async (client: McpClient): Promise<boolean> => {
			const tool = (await client.list()).find(
				(candidate) => candidate.name === "findVersions",
			);

			return Object.hasOwn(
				tool?.inputSchema["properties"] as Record<string, unknown>,
				"status",
			);
		};

		expect(await statusOf(editor)).toBe(true);
		expect(await statusOf(snippetsOnly)).toBe(false);
	});

	it("refuses status on an entity without drafts", async () => {
		const snippet = await booted.payload.create({
			collection: "snippets",
			data: { body: "Plain" },
		});

		const result = await editor.call("findVersions", {
			collection: "snippets",
			id: snippet.id,
			status: "published",
		});

		expect(result.isError).toBe(true);
		expect(result.data["error"]).toBe(
			'"snippets" has no drafts, so its versions carry no status.',
		);
	});

	it("covers a collection with versions but no drafts", async () => {
		const created = await editor.call("createDocument", {
			collection: "snippets",
			locale: "en",
			data: { body: "Before" },
		});
		const id = created.data["id"] as number | string;

		await editor.call("patchDocument", {
			collection: "snippets",
			id,
			locale: "en",
			patches: [{ op: "replace", path: "/body", value: "After" }],
		});

		const { data } = await editor.call("findVersions", {
			collection: "snippets",
			id,
		});
		const versions = data["versions"] as Version[];

		expect(versions).toHaveLength(2);
		expect(versions[0]?.status).toBeNull();

		const diff = await editor.call("getDocument", {
			collection: "snippets",
			id,
			diffFrom: versions[1]?.versionId,
		});

		expect(diff.data["patch"]).toEqual([
			{ op: "replace", path: "/body", value: "After" },
		]);

		const published = await editor.call("getDocument", {
			collection: "snippets",
			id,
			diffFrom: "published",
		});

		expect(published.isError).toBe(true);
		expect(published.data).toEqual({
			error: '"snippets" has no published version to diff from.',
		});
	});

	it("refuses the history of a document its read access hides", async () => {
		const hidden = await booted.payload.create({
			collection: "snippets",
			data: { body: "Hidden" },
		});
		const stored = await booted.payload.findVersions({
			collection: "snippets",
			where: { parent: { equals: hidden.id } },
		});

		const listed = await editor.call("findVersions", {
			collection: "snippets",
			id: hidden.id,
		});
		const read = await editor.call("getDocument", {
			collection: "snippets",
			id: hidden.id,
			versionId: stored.docs[0]?.id,
		});

		expect(listed.isError).toBe(true);
		expect(listed.data["error"]).toBe("Not Found");
		expect(read.isError).toBe(true);
		expect(read.data["error"]).toBe("Not Found");
	});

	it("lists and diffs a global's versions", async () => {
		for (const title of ["Old", "New"]) {
			await editor.call("patchDocument", {
				global: "site-settings",
				locale: "en",
				patches: [
					{ op: "replace", path: "/title", value: title },
					{ op: "replace", path: "/tagline", value: "Tagline" },
				],
			});
		}

		const { data } = await editor.call("findVersions", {
			global: "site-settings",
		});
		const versions = data["versions"] as Version[];

		expect(versions.length).toBeGreaterThanOrEqual(2);

		const diff = await editor.call("getDocument", {
			global: "site-settings",
			locale: "en",
			diffFrom: versions[1]?.versionId,
		});

		expect(diff.data["patch"]).toEqual([
			{ op: "replace", path: "/title", value: "New" },
		]);
	});
});
