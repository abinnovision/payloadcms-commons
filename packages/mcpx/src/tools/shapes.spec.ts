import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { BUILTIN_TOOLS } from "./index.js";
import { pages, posts, tags, users } from "../../test/fixtures/collections.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";
import {
	readableSlugs,
	resolveCapabilities,
	writableSlugs,
} from "../capabilities.js";
import { normalizeOptions } from "../options.js";

import type { ToolScope } from "./types.js";
import type { NormalizedOptions } from "../options.js";
import type { Config, PayloadRequest, SanitizedConfig } from "payload";

const FULL_KEY = {
	collections: {
		pages: { read: true, write: true },
		posts: { read: true, write: true },
		tags: { read: true },
	},
	tools: { echo: true },
};

const READ_ONLY_KEY = {
	collections: { pages: { read: true }, tags: { read: true } },
};

let config: SanitizedConfig;
let options: NormalizedOptions;

const scopeFor = (
	keyCapabilities: unknown,
	localization: "on" | "off" = "on",
): ToolScope => {
	const capabilities = resolveCapabilities(options, keyCapabilities);

	return {
		req: { payload: { config } } as unknown as PayloadRequest,
		options,
		capabilities,
		readable: readableSlugs(capabilities),
		writable: writableSlugs(capabilities),
		locales: localization === "on" ? ["en", "de"] : null,
		defaultLocale: localization === "on" ? "en" : null,
	};
};

const schemaOf = (scope: ToolScope, name: string) => {
	const tool = BUILTIN_TOOLS.find((candidate) => candidate.name === name);

	if (!tool) {
		throw new Error(`Unknown tool ${name}`);
	}

	return z.toJSONSchema(z.object(tool.inputSchema(scope))) as {
		properties: Record<string, Record<string, unknown>>;
		required?: string[];
	};
};

beforeAll(async () => {
	config = await buildFixtureConfig();

	// Options are normalized against the raw config, before the plugin adds
	// its own collection.
	const raw: Config = {
		secret: "",
		db: config.db,
		collections: [users, pages, posts, tags],
	};

	options = normalizeOptions(raw, {
		collections: {
			pages: { read: true, write: true },
			posts: { read: true, write: true },
			tags: true,
		},
		tools: [
			{ name: "echo", description: "", handler: () => ({ content: [] }) },
		],
	});
});

describe("builtin tool shapes", () => {
	it("limits collection enums to what the key may read or write", () => {
		const full = scopeFor(FULL_KEY);

		expect(
			schemaOf(full, "findDocuments").properties["collection"],
		).toMatchObject({ enum: ["pages", "posts", "tags"] });
		expect(
			schemaOf(full, "patchDocument").properties["collection"],
		).toMatchObject({ enum: ["pages", "posts"] });

		const readOnly = scopeFor(READ_ONLY_KEY);

		expect(
			schemaOf(readOnly, "describeSchema").properties["collection"],
		).toMatchObject({ enum: ["pages", "tags"] });
	});

	it("enables write tools only for keys that may write", () => {
		const enabled = (scope: ToolScope): string[] =>
			BUILTIN_TOOLS.filter((tool) => tool.isEnabled(scope)).map(
				(tool) => tool.name,
			);

		expect(enabled(scopeFor(FULL_KEY))).toEqual([
			"listCapabilities",
			"describeSchema",
			"findDocuments",
			"getDocument",
			"patchDocument",
			"createDocument",
			"validateDocument",
		]);
		expect(enabled(scopeFor(READ_ONLY_KEY))).toEqual([
			"listCapabilities",
			"describeSchema",
			"findDocuments",
			"getDocument",
		]);
		expect(enabled(scopeFor({}))).toEqual(["listCapabilities"]);
	});

	it("offers locale only when localization is configured", () => {
		const withLocales = schemaOf(scopeFor(FULL_KEY), "patchDocument");

		expect(withLocales.properties["locale"]).toMatchObject({
			enum: ["en", "de"],
		});
		expect(withLocales.required).toContain("locale");

		const without = schemaOf(scopeFor(FULL_KEY, "off"), "patchDocument");

		expect(without.properties).not.toHaveProperty("locale");
	});

	it("publishes the configured caps", () => {
		const find = schemaOf(scopeFor(FULL_KEY), "findDocuments");

		expect(find.properties["limit"]).toMatchObject({ maximum: 25 });
		expect(find.properties["depth"]).toMatchObject({ maximum: 1 });
	});

	it("keeps the whole builtin surface small", () => {
		const scope = scopeFor(FULL_KEY);
		const bytes = BUILTIN_TOOLS.reduce(
			(sum, tool) =>
				sum +
				JSON.stringify({
					name: tool.name,
					description: tool.description,
					inputSchema: schemaOf(scope, tool.name),
				}).length,
			0,
		);

		expect(bytes).toBeLessThan(16_000);
	});
});
