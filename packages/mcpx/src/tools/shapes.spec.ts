import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { BUILTIN_TOOLS } from "./index.js";
import { pages, posts, tags, users } from "../../test/fixtures/collections.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";
import { banner, siteSettings } from "../../test/fixtures/globals.js";
import {
	readableGlobalSlugs,
	readableSlugs,
	resolveCapabilities,
	writableGlobalSlugs,
	writableSlugs,
} from "../capabilities.js";
import { builtinInputSchema } from "../endpoint/server.js";
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
/** Same config, but with globals exposed too. */
let withGlobals: NormalizedOptions;

const scopeFor = (
	keyCapabilities: unknown,
	localization: "on" | "off" = "on",
	source: () => NormalizedOptions = () => options,
): ToolScope => {
	const resolved = source();
	const capabilities = resolveCapabilities(resolved, keyCapabilities);

	return {
		req: { payload: { config } } as unknown as PayloadRequest,
		options: resolved,
		capabilities,
		readable: readableSlugs(capabilities),
		writable: writableSlugs(capabilities),
		readableGlobals: readableGlobalSlugs(capabilities),
		writableGlobals: writableGlobalSlugs(capabilities),
		locales: localization === "on" ? ["en", "de"] : null,
		defaultLocale: localization === "on" ? "en" : null,
	};
};

const schemaOf = (scope: ToolScope, name: string) => {
	const tool = BUILTIN_TOOLS.find((candidate) => candidate.name === name);

	if (!tool) {
		throw new Error(`Unknown tool ${name}`);
	}

	return z.toJSONSchema(builtinInputSchema(tool, scope)) as {
		additionalProperties?: boolean;
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

	const collections = {
		pages: { read: true, write: true },
		posts: { read: true, write: true },
		tags: true,
	} as const;
	const tools = [
		{ name: "echo", description: "", handler: () => ({ content: [] }) },
	];

	options = normalizeOptions(raw, { collections, tools });
	withGlobals = normalizeOptions(
		{ ...raw, globals: [siteSettings, banner] },
		{
			collections,
			globals: { "site-settings": { read: true, write: true } },
			tools,
		},
	);
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

	it("rejects unknown arguments on every builtin tool", () => {
		const scope = scopeFor(FULL_KEY);

		for (const tool of BUILTIN_TOOLS) {
			expect(schemaOf(scope, tool.name).additionalProperties).toBe(false);
		}
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

describe("builtin tool shapes with globals", () => {
	const GLOBAL_KEY = { globals: { siteSettings: { read: true, write: true } } };
	const MIXED_KEY = {
		collections: { pages: { read: true, write: true } },
		globals: { siteSettings: { read: true, write: true } },
	};

	const mixed = () => scopeFor(MIXED_KEY, "on", () => withGlobals);
	const globalsOnly = () => scopeFor(GLOBAL_KEY, "on", () => withGlobals);

	it("leaves the schema untouched for a key that reaches no global", () => {
		// The regression guard: a collections-only key must see exactly the
		// shape it saw before globals existed.
		const scope = scopeFor(FULL_KEY, "on", () => withGlobals);

		for (const name of ["describeSchema", "getDocument", "patchDocument"]) {
			expect(schemaOf(scope, name).properties).not.toHaveProperty("global");
			expect(schemaOf(scope, name).required).toContain("collection");
		}

		for (const name of ["getDocument", "patchDocument"]) {
			expect(schemaOf(scope, name).required).toContain("id");
		}
	});

	it("drops collection and id for a key that reaches only globals", () => {
		const scope = globalsOnly();

		for (const name of ["describeSchema", "getDocument", "patchDocument"]) {
			const schema = schemaOf(scope, name);

			expect(schema.properties).not.toHaveProperty("collection");
			expect(schema.properties).not.toHaveProperty("id");
			expect(schema.required).toContain("global");
		}
	});

	it("does not enable the collection-only tools for a globals-only key", () => {
		const enabled = BUILTIN_TOOLS.filter((tool) =>
			tool.isEnabled(globalsOnly()),
		).map((tool) => tool.name);

		expect(enabled).toEqual([
			"listCapabilities",
			"describeSchema",
			"getDocument",
			"patchDocument",
			"validateDocument",
		]);
	});

	it("makes both targets optional only in the mixed case", () => {
		const schema = schemaOf(mixed(), "getDocument");

		expect(schema.properties["collection"]).toMatchObject({ enum: ["pages"] });
		expect(schema.properties["global"]).toMatchObject({
			enum: ["site-settings"],
		});
		expect(schema.required ?? []).not.toContain("collection");
		expect(schema.required ?? []).not.toContain("global");
		expect(schema.required ?? []).not.toContain("id");
	});

	it("still rejects unknown arguments in the mixed case", () => {
		for (const tool of BUILTIN_TOOLS) {
			expect(schemaOf(mixed(), tool.name).additionalProperties).toBe(false);
		}
	});

	it("keeps global off the collection-only tools", () => {
		for (const name of ["findDocuments", "createDocument"]) {
			expect(schemaOf(mixed(), name).properties).not.toHaveProperty("global");
		}
	});
});
