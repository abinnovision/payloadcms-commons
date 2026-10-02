import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { instructionsFor, toolsList } from "./helpers/mcp.js";
import { bootPayload, createKey, USER } from "./helpers/payload.js";

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
};

describe("tools/list and initialize", () => {
	let booted: Booted;
	const keys: Record<string, string> = {};

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				collections: {
					pages: { read: true, write: "live" },
					posts: { read: true, write: "draft" },
					tags: { read: true, write: "live" },
					notes: { read: true, write: "live" },
					snippets: { read: true, write: "live" },
					media: { read: true },
				},
				globals: {
					"site-settings": { read: true, write: "live" },
					banner: { read: true, write: "live" },
				},
				tools: [],
			},
		});

		const user = await booted.payload.create({
			collection: "users",
			data: USER,
		});

		for (const [label, capabilities] of Object.entries(KEYS)) {
			keys[label] = await createKey(booted.payload, {
				userId: user.id,
				label,
				capabilities,
			});
		}
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it.each(Object.keys(KEYS))("lists the tools a %s key sees", async (label) => {
		const tools = await toolsList(booted.config, keys[label]!, CACHE_KEY);

		await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot(
			`${SNAPSHOTS}.${label}.tools.json`,
		);
	});

	it.each(Object.keys(KEYS))(
		"states the instructions a %s key receives",
		async (label) => {
			const instructions = await instructionsFor(
				booted.config,
				keys[label]!,
				CACHE_KEY,
			);

			expect(instructions).not.toBe("");
			await expect(instructions).toMatchFileSnapshot(
				`${SNAPSHOTS}.${label}.instructions.txt`,
			);
		},
	);
});
