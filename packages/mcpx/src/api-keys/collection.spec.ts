import { beforeAll, describe, expect, it } from "vitest";

import { keyBeforeChange } from "./collection.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type {
	Field,
	SanitizedCollectionConfig,
	SanitizedConfig,
} from "payload";

const fieldNames = (fields: Field[]): string[] =>
	fields.flatMap((field) =>
		"name" in field && field.name ? [field.name] : [],
	);

const subFields = (fields: Field[], name: string): Field[] => {
	const field = fields.find(
		(candidate) => "name" in candidate && candidate.name === name,
	);

	return field && "fields" in field ? field.fields : [];
};

describe("api keys collection", () => {
	let config: SanitizedConfig;
	let collection: SanitizedCollectionConfig;

	beforeAll(async () => {
		config = await buildFixtureConfig();
		const found = config.collections.find(
			(candidate) => candidate.slug === "mcpx-api-keys",
		);

		if (!found) {
			throw new Error("api keys collection missing");
		}

		collection = found;
	});

	it("is not an auth collection", () => {
		expect(collection.auth).toBeFalsy();
	});

	it("carries the key fields", () => {
		expect(fieldNames(collection.fields)).toEqual(
			expect.arrayContaining([
				"user",
				"label",
				"enabled",
				"apiKey",
				"apiKeyIndex",
				"capabilities",
			]),
		);
	});

	it("generates a checkbox per exposed operation only", () => {
		const collections = subFields(
			subFields(collection.fields, "capabilities"),
			"collections",
		);

		expect(fieldNames(collections)).toEqual(["pages", "posts", "tags"]);
		expect(fieldNames(subFields(collections, "pages"))).toEqual([
			"read",
			"write",
		]);
		expect(fieldNames(subFields(collections, "tags"))).toEqual(["read"]);
	});

	it("generates a checkbox per custom tool", () => {
		const tools = subFields(
			subFields(collection.fields, "capabilities"),
			"tools",
		);

		expect(fieldNames(tools)).toEqual(["echo"]);
	});

	it("installs the key hook", () => {
		expect(collection.hooks.beforeChange).toContain(keyBeforeChange);
	});

	it("applies the collection override", async () => {
		const overridden = await buildFixtureConfig({
			plugin: {
				apiKeys: {
					overrideCollection: (c) => ({
						...c,
						admin: { ...c.admin, group: "Custom" },
					}),
				},
			},
		});

		expect(
			overridden.collections.find((c) => c.slug === "mcpx-api-keys")?.admin
				.group,
		).toBe("Custom");
	});
});

describe("keyBeforeChange", () => {
	const req = { payload: { secret: "secret" } };

	const run = (
		data: Record<string, unknown>,
		operation: "create" | "update",
	): Record<string, unknown> => {
		const hookArgs: unknown = { data, operation, req };

		return keyBeforeChange(hookArgs as never) as Record<string, unknown>;
	};

	it("generates a key and its index on create", () => {
		const data = run({ label: "ci" }, "create");

		expect(data["apiKey"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(data["apiKeyIndex"]).toMatch(/^[a-f0-9]{64}$/);
	});

	// Only privileged callers reach the hook with a value: the apiKey field
	// denies create and update access, so client-supplied keys never arrive.
	it("keeps a key supplied with overrideAccess and indexes it", () => {
		const data = run({ apiKey: "given" }, "create");

		expect(data["apiKey"]).toBe("given");
		expect(typeof data["apiKeyIndex"]).toBe("string");
	});

	it("does not mint a key on update", () => {
		expect(run({ label: "renamed" }, "update")).toEqual({ label: "renamed" });
	});
});
