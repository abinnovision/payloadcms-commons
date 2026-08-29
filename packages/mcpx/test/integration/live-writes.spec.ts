import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool, instructionsFor, toolsList } from "./helpers/mcp.js";
import { bootPayload, createKey, USER } from "./helpers/payload.js";

import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-live-writes";

describe("live writes", () => {
	let booted: Booted;
	let live: string;
	let draftsOnly: string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				collections: {
					pages: { read: true, write: "draft" },
					tags: { read: true, write: "live" },
				},
				globals: { banner: { read: true, write: "live" } },
			},
		});

		const user = await booted.payload.create({
			collection: "users",
			data: USER,
		});

		live = await createKey(booted.payload, {
			userId: user.id,
			label: "live",
			capabilities: {
				collections: {
					pages: { read: true, write: true },
					tags: { read: true, write: true },
				},
				globals: { banner: { read: true, write: true } },
			},
		});

		draftsOnly = await createKey(booted.payload, {
			userId: user.id,
			label: "drafts-only",
			capabilities: { collections: { pages: { read: true, write: true } } },
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const descriptionOf = async (name: string, key: string): Promise<string> => {
		const tools = await toolsList(booted.config, key, CACHE_KEY);

		return tools.find((tool) => tool.name === name)?.description ?? "";
	};

	it("names the targets that write live in the server instructions", async () => {
		const instructions = await instructionsFor(booted.config, live, CACHE_KEY);

		expect(instructions).toContain("tags");
		expect(instructions).toContain("banner");
	});

	it("keeps the draft-only promise for a key that cannot write live", async () => {
		const instructions = await instructionsFor(
			booted.config,
			draftsOnly,
			CACHE_KEY,
		);

		expect(instructions).toContain("lands as a draft");
		expect(instructions).not.toContain("tags");
		expect(instructions).not.toContain("banner");
	});

	const writeDescriptions = (key: string): Promise<string[]> =>
		Promise.all(
			["patchDocument", "createDocument"].map((name) =>
				descriptionOf(name, key),
			),
		);

	it("names the targets that write live in the write tool descriptions", async () => {
		for (const description of await writeDescriptions(live)) {
			expect(description).toContain("tags");
			expect(description).toContain("banner");
		}
	});

	it("leaves the write tool descriptions draft-only for every other key", async () => {
		for (const description of await writeDescriptions(draftsOnly)) {
			expect(description).toContain("lands as a draft");
			expect(description).not.toContain("banner");
		}
	});

	it("writes a collection without drafts live, as the description says", async () => {
		const result = await callTool(
			booted.config,
			live,
			"createDocument",
			{ collection: "tags", locale: "en", data: { name: "Live" } },
			CACHE_KEY,
		);

		expect(result.isError).toBe(false);

		const doc = await booted.payload.findByID({
			collection: "tags",
			id: result.data["id"] as number | string,
		});

		expect(doc).toMatchObject({ name: "Live" });
		expect(doc).not.toHaveProperty("_status");
	});
});
