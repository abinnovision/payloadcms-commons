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

/**
 * Expands the tab wrapper so assertions can stay flat.
 */
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
										slug: "pages",
										read: true,
										write: true,
									},
									{
										fieldName: "posts",
										slug: "posts",
										read: true,
										write: true,
									},
									{
										fieldName: "tags",
										slug: "tags",
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
		const guideTab = tabs?.type === "tabs" ? tabs.tabs[2] : undefined;
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

	it("keeps the capabilities in a tab of their own", () => {
		const [tabs] = collection.fields;
		const labels = tabs?.type === "tabs" ? tabs.tabs.map((t) => t.label) : [];

		expect(labels).toEqual(["Key", "Capabilities", "Connect a client"]);
		expect(
			fieldNames(tabs?.type === "tabs" ? (tabs.tabs[1]?.fields ?? []) : []),
		).toEqual(["capabilities"]);
	});

	it("drops only the guide tab when the guide is turned off", async () => {
		const built = await buildFixtureConfig({
			plugin: { apiKeys: { setupGuide: false } },
		});
		const without = built.collections.find((c) => c.slug === "mcpx-api-keys");
		const [tabs] = without?.fields ?? [];

		expect(fieldNames(without?.fields ?? [])).not.toContain("setupGuide");
		expect(tabs?.type === "tabs" ? tabs.tabs.map((t) => t.label) : []).toEqual([
			"Key",
			"Capabilities",
		]);
		expect(fieldNames(without?.fields ?? [])).toEqual(
			expect.arrayContaining(["user", "label", "apiKey", "capabilities"]),
		);
	});

	it("lists pending calls above the tabs only where a collection exposes delete", async () => {
		const built = await buildFixtureConfig({
			plugin: { collections: { tags: { delete: true } } },
		});
		const keys = built.collections.find((c) => c.slug === "mcpx-api-keys");
		const [first, second] = keys?.fields ?? [];

		expect(first).toMatchObject({ name: "confirmations", type: "ui" });
		expect(second?.type).toBe("tabs");
		expect(
			fieldNames(
				config.collections.find((c) => c.slug === "mcpx-api-keys")?.fields ??
					[],
			),
		).not.toContain("confirmations");
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
		context: Record<string, unknown> = {},
	): Record<string, unknown> => {
		const hookArgs: unknown = { context, data, operation, req };

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

	it("leaves the index alone on a last-used touch", () => {
		const data = run({ apiKey: "given" }, "update", { mcpxTouch: true });

		expect(data).toEqual({ apiKey: "given" });
	});
});
