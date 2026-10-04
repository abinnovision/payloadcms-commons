import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";

import type { Booted, KeyCapabilities } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-tools-list";

/*
 * Byte-for-byte lock on everything the model reads. Output is serialised as
 * returned, with no key sorting or text normalisation, so any change to a
 * description, schema or the instructions shows up in the snapshot diff.
 */
const SNAPSHOTS = "./__snapshots__/tools-list";

const KEYS: Record<string, KeyCapabilities> = {
	full: {
		collections: {
			pages: { read: true, write: true, publish: true },
			posts: { read: true, write: true },
			tags: { read: true, write: true },
			notes: { read: true, write: true, publish: true },
			snippets: { read: true, write: true },
			media: { read: true },
		},
		globals: {
			siteSettings: { read: true, write: true, publish: true },
			banner: { read: true, write: true },
		},
	},
	"read-only": {
		collections: {
			pages: { read: true },
			posts: { read: true },
			tags: { read: true },
			notes: { read: true },
			snippets: { read: true },
			media: { read: true },
		},
		globals: { siteSettings: { read: true }, banner: { read: true } },
	},
	"collections-only": {
		collections: {
			pages: { read: true, write: true, publish: true },
			posts: { read: true, write: true },
			tags: { read: true, write: true },
			notes: { read: true, write: true, publish: true },
			snippets: { read: true, write: true },
			media: { read: true },
		},
	},
	/* May write the upload collection, which createDocument leaves out. */
	uploads: {
		collections: {
			pages: { read: true, write: true },
			media: { read: true, write: true },
		},
	},
	/* No collection: createDocument, findDocuments and findVersions are left out. */
	"globals-only": {
		globals: {
			siteSettings: { read: true, write: true, publish: true },
			banner: { read: true, write: true },
		},
	},
	/* Reaches no entity with exposed versions. */
	"no-versions": {
		collections: {
			tags: { read: true, write: true },
		},
		globals: { banner: { read: true, write: true } },
	},
	/* Writes without read access: no describeSchema, so no schema paths. */
	"write-only": {
		collections: { posts: { write: true } },
	},
	/* May ask to delete, permanently in tags. */
	deletes: {
		collections: {
			pages: { read: true, delete: true },
			tags: { read: true, delete: true },
		},
	},
	/* Every write lands as a draft: no live-write slug. */
	"drafts-only": {
		collections: {
			posts: { read: true, write: true },
			pages: { read: true },
		},
	},
};

/*
 * Characters a model reads per tool: the description plus every parameter
 * description, as the largest of all keys.
 */
const BUDGET: Record<string, number> = {
	describeSchema: 1700,
	patchDocument: 1700,
	getDocument: 1200,
	createDocument: 800,
	deleteDocument: 800,
};

const DEFAULT_BUDGET = 600;

const INSTRUCTIONS_BUDGET = 1000;

const descriptionsIn = (schema: unknown): string[] => {
	if (Array.isArray(schema)) {
		return schema.flatMap(descriptionsIn);
	}

	if (typeof schema !== "object" || schema === null) {
		return [];
	}

	return Object.entries(schema).flatMap(([key, value]) =>
		key === "description" && typeof value === "string"
			? [value]
			: descriptionsIn(value),
	);
};

describe("tools/list and initialize", () => {
	let booted: Booted;
	let keys: Record<string, string>;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				collections: {
					pages: { delete: true },
					posts: { publish: false },
					tags: { delete: true },
					notes: true,
					snippets: true,
					media: true,
				},
				globals: {
					"site-settings": true,
					banner: true,
				},
				tools: [],
			},
		});

		({ keys } = await seedKeysFor(booted.payload, KEYS));
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it.each(Object.keys(KEYS))("lists the tools a %s key sees", async (label) => {
		const tools = await createMcpClient(booted, keys[label]).list();

		await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot(
			`${SNAPSHOTS}.${label}.tools.snap`,
		);
	});

	it("keeps the text of each tool of every key within its budget", async () => {
		const overBudget: string[] = [];

		for (const label of Object.keys(KEYS)) {
			const mcp = createMcpClient(booted, keys[label]);

			for (const tool of await mcp.list()) {
				const length = [
					tool.description ?? "",
					...descriptionsIn(tool.inputSchema),
				].join("").length;

				if (length > (BUDGET[tool.name] ?? DEFAULT_BUDGET)) {
					overBudget.push(`${label}: ${tool.name}`);
				}
			}

			if ((await mcp.instructions()).length > INSTRUCTIONS_BUDGET) {
				overBudget.push(`${label}: instructions`);
			}
		}

		expect(overBudget).toEqual([]);
	});

	it.each(Object.keys(KEYS))(
		"uses no em-dash in what a %s key reads",
		async (label) => {
			const mcp = createMcpClient(booted, keys[label]);
			const text =
				JSON.stringify(await mcp.list()) + (await mcp.instructions());

			expect(text).not.toContain("\u2014");
		},
	);

	it.each(Object.keys(KEYS))(
		"states the instructions a %s key receives",
		async (label) => {
			const instructions = await createMcpClient(
				booted,
				keys[label],
			).instructions();

			expect(instructions).not.toBe("");
			await expect(instructions).toMatchFileSnapshot(
				`${SNAPSHOTS}.${label}.instructions.txt`,
			);
		},
	);
});
