import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { isToolEnabled, toolInputSchema } from "./server.js";
import { scopeFor } from "../../test/builders/scope.js";
import {
	media,
	pages,
	posts,
	tags,
	users,
} from "../../test/fixtures/collections.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";
import { banner, siteSettings } from "../../test/fixtures/globals.js";
import { normalizeOptions } from "../options.js";
import { BUILTIN_TOOLS } from "../tools/builtin.js";

import type { NormalizedOptions } from "../options.js";
import type { McpxToolScope } from "../types.js";
import type { Config, SanitizedConfig } from "payload";

const FULL_KEY = {
	collections: {
		pages: { read: true, write: true },
		posts: { read: true, write: true },
		tags: { read: true },
	},
	tools: { echo: true, whichCollection: true },
};

const READ_ONLY_KEY = {
	collections: { pages: { read: true }, tags: { read: true } },
};

let config: SanitizedConfig;
let options: NormalizedOptions;
/**
 * Same config, but with globals exposed too.
 */
let withGlobals: NormalizedOptions;
/**
 * Same config, but with the upload collection exposed for write too.
 */
let withUpload: NormalizedOptions;

const schemaOf = (scope: McpxToolScope, name: string) => {
	const tool = BUILTIN_TOOLS.find((candidate) => candidate.name === name);

	if (!tool) {
		throw new Error(`Unknown tool ${name}`);
	}

	return z.toJSONSchema(toolInputSchema(tool, scope)) as {
		additionalProperties?: boolean;
		properties: Record<string, Record<string, unknown>>;
		required?: string[];
	};
};

beforeAll(async () => {
	config = await buildFixtureConfig();

	/*
	 * Options are normalized against the raw config, before the plugin adds
	 * its own collection.
	 */
	const raw: Config = {
		secret: "",
		db: config.db,
		collections: [users, pages, posts, tags, media],
	};

	const collections = {
		pages: { publish: false },
		posts: { publish: false },
		tags: { write: false },
	} as const;
	const tools = [
		{ name: "echo", description: "", handler: () => ({ content: [] }) },
	];

	options = normalizeOptions(raw, { collections, tools });
	withUpload = normalizeOptions(raw, {
		collections: { ...collections, media: { publish: false } },
		tools,
	});
	withGlobals = normalizeOptions(
		{ ...raw, globals: [siteSettings, banner] },
		{
			collections,
			globals: {
				"site-settings": { publish: false },
			},
			tools,
		},
	);
});

describe("builtin tool shapes", () => {
	it("limits collection enums to what the key may read or write", () => {
		const full = scopeFor(options, FULL_KEY, config);

		expect(
			schemaOf(full, "findDocuments").properties["collection"],
		).toMatchObject({ enum: ["pages", "posts", "tags"] });
		expect(
			schemaOf(full, "patchDocument").properties["collection"],
		).toMatchObject({ enum: ["pages", "posts"] });

		const readOnly = scopeFor(options, READ_ONLY_KEY, config);

		expect(
			schemaOf(readOnly, "describeSchema").properties["collection"],
		).toMatchObject({ enum: ["pages", "tags"] });
	});

	it("keeps an upload collection out of createDocument but not patchDocument", () => {
		const scope = scopeFor(
			withUpload,
			{
				collections: {
					pages: { read: true, write: true },
					media: { read: true, write: true },
				},
			},
			config,
		);

		expect(
			schemaOf(scope, "patchDocument").properties["collection"],
		).toMatchObject({ enum: ["pages", "media"] });
		expect(
			schemaOf(scope, "createDocument").properties["collection"],
		).toMatchObject({ enum: ["pages"] });
	});

	it("disables createDocument for a key whose only write is an upload collection", () => {
		const scope = scopeFor(
			withUpload,
			{ collections: { media: { read: true, write: true } } },
			config,
		);
		const names = BUILTIN_TOOLS.filter((tool) =>
			isToolEnabled(tool, scope),
		).map((tool) => tool.name);

		expect(names).toContain("patchDocument");
		expect(names).not.toContain("createDocument");
	});

	it("enables write tools only for keys that may write", () => {
		const enabled = (scope: McpxToolScope): string[] =>
			BUILTIN_TOOLS.filter((tool) => isToolEnabled(tool, scope)).map(
				(tool) => tool.name,
			);

		expect(enabled(scopeFor(options, FULL_KEY, config))).toEqual([
			"listCapabilities",
			"describeSchema",
			"findDocuments",
			"getDocument",
			"findVersions",
			"patchDocument",
			"createDocument",
			"validateDocument",
		]);
		expect(enabled(scopeFor(options, READ_ONLY_KEY, config))).toEqual([
			"listCapabilities",
			"describeSchema",
			"findDocuments",
			"getDocument",
			"findVersions",
		]);
		expect(enabled(scopeFor(options, {}, config))).toEqual([
			"listCapabilities",
		]);
	});

	it("leaves the version tool and arguments out for a key that reaches no exposed versions", () => {
		const scope = scopeFor(
			options,
			{ collections: { tags: { read: true } } },
			config,
		);
		const names = BUILTIN_TOOLS.filter((tool) =>
			isToolEnabled(tool, scope),
		).map((tool) => tool.name);
		const { properties } = schemaOf(scope, "getDocument");

		expect(names).not.toContain("findVersions");
		expect(properties).not.toHaveProperty("versionId");
		expect(properties).not.toHaveProperty("diffFrom");
	});

	it("offers the version arguments for a key that reaches an exposed entity", () => {
		const scope = scopeFor(options, READ_ONLY_KEY, config);
		const { properties } = schemaOf(scope, "getDocument");

		expect(properties).toHaveProperty("versionId");
		expect(properties).toHaveProperty("diffFrom");
		expect(schemaOf(scope, "findVersions").properties).toHaveProperty("status");
	});

	it("offers locale only when localization is configured", () => {
		const withLocales = schemaOf(
			scopeFor(options, FULL_KEY, config),
			"patchDocument",
		);

		expect(withLocales.properties["locale"]).toMatchObject({
			enum: ["en", "de"],
		});
		expect(withLocales.required).toContain("locale");

		const without = schemaOf(
			scopeFor(options, FULL_KEY, { ...config, localization: false }),
			"patchDocument",
		);

		expect(without.properties).not.toHaveProperty("locale");
	});

	it("publishes the configured caps", () => {
		const find = schemaOf(scopeFor(options, FULL_KEY, config), "findDocuments");

		expect(find.properties["limit"]).toMatchObject({ maximum: 25 });
		expect(find.properties["depth"]).toMatchObject({ maximum: 1 });
	});

	it("rejects unknown arguments on every builtin tool", () => {
		const scope = scopeFor(options, FULL_KEY, config);

		for (const tool of BUILTIN_TOOLS) {
			expect(schemaOf(scope, tool.name).additionalProperties).toBe(false);
		}
	});

	it("keeps the whole builtin surface small", () => {
		const scope = scopeFor(options, FULL_KEY, config);
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

	const mixed = () => scopeFor(withGlobals, MIXED_KEY, config);
	const globalsOnly = () => scopeFor(withGlobals, GLOBAL_KEY, config);

	it("leaves the schema untouched for a key that reaches no global", () => {
		const scope = scopeFor(withGlobals, FULL_KEY, config);

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
			isToolEnabled(tool, globalsOnly()),
		).map((tool) => tool.name);

		expect(enabled).toEqual([
			"listCapabilities",
			"describeSchema",
			"getDocument",
			"findVersions",
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
