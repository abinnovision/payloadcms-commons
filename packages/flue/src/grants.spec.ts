import { describe, expect, it } from "vitest";

import { capabilityFields, validateGrants } from "./grants.js";
import { EDITOR, fixtureConfig, RESTRICTED } from "../test/fixtures/config.js";

import type { NormalizedFiles } from "./options.js";
import type { FlueAgentConfig } from "./types.js";
import type { CollectionConfig, Config } from "payload";

const API_KEYS = "mcpx-api-keys";

const keysOf = (config: Config): CollectionConfig => {
	const keys = config.collections?.find(
		(collection) => collection.slug === API_KEYS,
	);

	if (!keys) {
		throw new Error("No key collection.");
	}

	return keys;
};

// The plugin functions in registration order, as buildConfig runs them.
const applyPlugins = async (count?: number): Promise<Config> => {
	let config = fixtureConfig({ sidecarUrl: "http://127.0.0.1:3101" });

	for (const plugin of (config.plugins ?? []).slice(0, count)) {
		// Each plugin takes the config the previous one returned.
		// eslint-disable-next-line no-await-in-loop
		config = await plugin(config);
	}

	return config;
};

describe("capabilityFields", () => {
	it("maps each slug to mcpx's group and checkboxes", async () => {
		expect(capabilityFields(keysOf(await applyPlugins()))).toEqual({
			collections: {
				pages: { field: "pages", operations: ["read", "write", "publish"] },
				posts: { field: "posts", operations: ["read", "write", "delete"] },
			},
			globals: {},
			tools: [],
		});
	});
});

describe("validateGrants", () => {
	const validate = async (
		agent: FlueAgentConfig,
		files: false | NormalizedFiles = false,
	): Promise<string[]> => {
		const warnings: string[] = [];

		validateGrants(
			capabilityFields(keysOf(await applyPlugins())),
			{ agents: [agent], files },
			{
				warn: (message) => {
					warnings.push(message);
				},
			},
		);

		return warnings;
	};

	const files = (collection: string): NormalizedFiles => ({
		collection,
		maxFilesPerTurn: 10,
		deliver: () => "reference",
	});

	it("accepts an agent taking files of a collection mcpx offers read for", async () => {
		expect(
			await validate(
				{
					...RESTRICTED,
					files: true,
					capabilities: { collections: { pages: { read: true } } },
				},
				files("pages"),
			),
		).toEqual([]);
	});

	it("refuses an agent taking files when mcpx offers no read checkbox for the collection", async () => {
		await expect(
			validate({ ...RESTRICTED, files: true }, files("uploads")),
		).rejects.toThrow(
			/Agent "restricted" takes files, but mcpx does not expose "uploads"\. Add "uploads": \{\} to mcpxPlugin\(\{ collections \}\) so agents with files can read it\./,
		);
	});

	it("accepts the fixture agents without warnings", async () => {
		expect(await validate(EDITOR)).toEqual([]);
		expect(await validate(RESTRICTED)).toEqual([]);
	});

	it("refuses an operation mcpx offers no checkbox for", async () => {
		await expect(
			validate({
				slug: "editor",
				capabilities: {
					collections: { posts: { read: true, write: true, publish: true } },
				},
			}),
		).rejects.toThrow(
			/Agent "editor": capabilities\.collections\.posts\.publish/,
		);
	});

	it("refuses publish without write", async () => {
		await expect(
			validate({
				slug: "editor",
				capabilities: { collections: { pages: { read: true, publish: true } } },
			}),
		).rejects.toThrow(
			/collections\.pages\.publish needs collections\.pages\.write/,
		);
	});

	it("warns on delete for an ambient agent", async () => {
		expect(
			await validate({
				...EDITOR,
				ambient: { cron: "0 * * * *", message: "Tidy up." },
			}),
		).toEqual([expect.stringContaining('Agent "editor" runs ambient')]);
	});
});
