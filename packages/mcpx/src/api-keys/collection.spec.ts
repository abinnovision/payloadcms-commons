import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { keyBeforeChange } from "./collection.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type {
	Condition,
	Field,
	Operation,
	SanitizedCollectionConfig,
	SanitizedConfig,
} from "payload";

/** Expands the tab wrapper so assertions can stay flat. */
const flatten = (fields: Field[]): Field[] =>
	fields.flatMap((field) =>
		field.type === "tabs" ? field.tabs.flatMap((tab) => tab.fields) : [field],
	);

const fieldNames = (fields: Field[]): string[] =>
	flatten(fields).flatMap((field) =>
		"name" in field && field.name ? [field.name] : [],
	);

const findField = (fields: Field[], name: string): Field | undefined =>
	flatten(fields).find(
		(candidate) => "name" in candidate && candidate.name === name,
	);

const subFields = (fields: Field[], name: string): Field[] => {
	const field = findField(fields, name);

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

		expect(fieldNames(tools)).toEqual(["echo", "whichCollection"]);
	});

	/*
	 * The matrix draws its rows from the same descriptor that generated the
	 * checkboxes, which is what keeps the two from drifting.
	 */
	it("hands the matrix a row per exposed collection and custom tool", () => {
		expect(findField(collection.fields, "capabilities")).toMatchObject({
			admin: {
				components: {
					Field: {
						clientProps: {
							matrix: {
								collections: [
									{
										fieldName: "pages",
										label: "pages",
										read: true,
										write: true,
									},
									{
										fieldName: "posts",
										label: "posts",
										read: true,
										write: true,
									},
									{
										fieldName: "tags",
										label: "tags",
										read: true,
										write: false,
										publish: false,
									},
								],
								tools: [{ name: "echo" }, { name: "whichCollection" }],
							},
						},
					},
				},
			},
		});
	});

	/*
	 * A `ui` field holds no data, so the guide can never widen what a key
	 * document stores or exposes over the REST API.
	 */
	it("carries the setup guide as a field that stores nothing", () => {
		expect(findField(collection.fields, "setupGuide")?.type).toBe("ui");
	});

	it("mounts both admin components from the admin entrypoint", () => {
		for (const name of ["capabilities", "setupGuide"]) {
			expect(findField(collection.fields, name)).toMatchObject({
				admin: {
					components: {
						Field: { path: "@abinnovision/payloadcms-mcpx/admin" },
					},
				},
			});
		}
	});

	it("passes a custom endpoint path to the component", async () => {
		const built = await buildFixtureConfig({
			plugin: { endpoint: { path: "/mcp" } },
		});
		const guide = findField(
			built.collections.find((c) => c.slug === "mcpx-api-keys")?.fields ?? [],
			"setupGuide",
		);

		expect(guide).toMatchObject({
			admin: {
				components: { Field: { clientProps: { endpointPath: "/mcp" } } },
			},
		});
	});

	it("hides the guide tab on create and shows it on update", () => {
		const [tabs] = collection.fields;
		const guideTab = tabs?.type === "tabs" ? tabs.tabs[1] : undefined;
		const condition = guideTab?.admin?.condition;

		const args = (operation: Operation): Parameters<Condition>[2] => ({
			blockData: {},
			operation,
			path: [],
			user: null,
		});

		expect(condition).toBeTypeOf("function");
		expect(condition?.({}, {}, args("create"))).toBe(false);
		expect(condition?.({}, {}, args("update"))).toBe(true);
	});

	it("drops the tabs entirely when the guide is turned off", async () => {
		const built = await buildFixtureConfig({
			plugin: { apiKeys: { setupGuide: false } },
		});
		const without = built.collections.find((c) => c.slug === "mcpx-api-keys");

		expect(fieldNames(without?.fields ?? [])).not.toContain("setupGuide");
		expect(without?.fields.some((field) => field.type === "tabs")).toBe(false);
		// The opt-out must leave the original flat layout untouched.
		expect(fieldNames(without?.fields ?? [])).toEqual(
			expect.arrayContaining(["user", "label", "apiKey", "capabilities"]),
		);
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

	const indexOf = (key: unknown): string =>
		crypto.createHmac("sha256", "secret").update(String(key)).digest("hex");

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
		expect(data["apiKeyIndex"]).toBe(indexOf(data["apiKey"]));
	});

	/*
	 * Only privileged callers reach the hook with a value: the apiKey field
	 * denies create and update access, so client-supplied keys never arrive.
	 */
	it("keeps a key supplied with overrideAccess and indexes it", () => {
		const data = run({ apiKey: "given" }, "create");

		expect(data["apiKey"]).toBe("given");
		expect(data["apiKeyIndex"]).toBe(indexOf("given"));
	});

	it("does not mint a key on update", () => {
		expect(run({ label: "renamed" }, "update")).toEqual({ label: "renamed" });
	});
});
