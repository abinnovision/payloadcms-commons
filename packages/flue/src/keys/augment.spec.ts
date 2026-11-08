import { flattenTopLevelFields } from "payload";
import { beforeAll, describe, expect, it } from "vitest";

import {
	augmentKeyCollection,
	capabilityFields,
	validateGrants,
} from "./augment.js";
import {
	EDITOR,
	fixtureConfig,
	RESTRICTED,
} from "../../test/fixtures/config.js";

import type { FlueAgentConfig } from "../types.js";
import type {
	CollectionConfig,
	Config,
	Field,
	FieldAccessArgs,
	PayloadRequest,
	SelectType,
	TextField,
} from "payload";

const API_KEYS = "mcpx-api-keys";

// A structural request for functions that only pass it on.
const req = {} as unknown as PayloadRequest;

const fieldOf = (collection: CollectionConfig, name: string): Field => {
	const field = flattenTopLevelFields(collection.fields).find(
		(candidate) => "name" in candidate && candidate.name === name,
	);

	if (!field) {
		throw new Error(`No field "${name}".`);
	}

	return field as Field;
};

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

describe("augmentKeyCollection", () => {
	let mcpxKeys: CollectionConfig;
	let augmented: CollectionConfig;

	const select = (caller: SelectType | undefined, collection = augmented) =>
		collection.select?.({
			operation: "read",
			req,
			...(caller === undefined ? {} : { select: caller }),
		});

	beforeAll(async () => {
		mcpxKeys = keysOf(await applyPlugins(1));
		augmented = keysOf(await applyPlugins());
	});

	it("adds managedBy as a text field hidden from the admin only", () => {
		const marker = fieldOf(augmented, "managedBy");

		expect(marker).toMatchObject({
			type: "text",
			index: true,
			admin: { hidden: true },
		});
		expect(marker).not.toHaveProperty("hidden");
	});

	it("keeps keys out of rich text relationships and links", () => {
		expect(augmented.admin).toMatchObject({
			enableRichTextLink: false,
			enableRichTextRelationship: false,
		});
	});

	it("ands an existing list filter with the unmanaged filter", async () => {
		const existing = { label: { equals: "Mine" } };
		const filterOf = (collection: CollectionConfig) =>
			collection.admin?.baseFilter?.({
				limit: 10,
				page: 1,
				req,
				sort: "label",
			});

		expect(
			await filterOf(
				augmentKeyCollection({
					...mcpxKeys,
					admin: { ...mcpxKeys.admin, baseFilter: () => existing },
				}),
			),
		).toEqual({ and: [existing, { managedBy: { exists: false } }] });
		expect(await filterOf(augmented)).toEqual({
			managedBy: { exists: false },
		});
	});

	describe("select", () => {
		const after = (existing: () => SelectType) =>
			augmentKeyCollection({ ...mcpxKeys, select: existing });

		it("adds managedBy in include mode", () => {
			expect(select({ apiKey: true })).toEqual({
				apiKey: true,
				managedBy: true,
			});
			expect(
				select(
					undefined,
					after(() => ({ label: true })),
				),
			).toEqual({
				label: true,
				managedBy: true,
			});
		});

		it("drops managedBy: false in exclude mode", () => {
			expect(select({ managedBy: false, label: false })).toEqual({
				label: false,
			});
			expect(
				select(
					undefined,
					after(() => ({ managedBy: false, apiKey: false })),
				),
			).toEqual({ apiKey: false });
		});

		it("keeps a select that excludes only managedBy, for the read lock to look up", () => {
			expect(select({ managedBy: false })).toEqual({
				managedBy: false,
			});
		});

		it("leaves an absent select absent", () => {
			expect(select(undefined)).toBeUndefined();
		});
	});

	it("fails startup for a key collection without apiKey", () => {
		expect(() =>
			augmentKeyCollection({
				...mcpxKeys,
				fields: [
					{ name: "user", type: "text" },
					{ name: "capabilities", type: "group", fields: [] },
				],
			}),
		).toThrow(/"apiKey"/);
	});

	it("fails startup for an mcpx managedBy that is not a text field", () => {
		expect(() =>
			augmentKeyCollection({
				...mcpxKeys,
				fields: [...mcpxKeys.fields, { name: "managedBy", type: "checkbox" }],
			}),
		).toThrow(/"managedBy" as a checkbox field/);
	});

	describe("the apiKey read lock", () => {
		const readAs = (
			doc: Record<string, unknown>,
			findByID: () => Promise<unknown>,
		) => {
			const { access } = fieldOf(augmented, "apiKey") as TextField;

			if (!access?.read) {
				throw new Error("The apiKey field has no read access.");
			}

			return access.read({
				id: 1,
				doc,
				req: { payload: { findByID } },
			} as unknown as FieldAccessArgs);
		};

		const lookup = (stored: unknown) => () => Promise.resolve(stored);
		const unused = () => Promise.reject(new Error("Looked up."));

		it("decides from the row's marker", async () => {
			expect(await readAs({ id: 1, managedBy: null }, unused)).toBe(true);
			expect(await readAs({ id: 1, managedBy: "flue:editor" }, unused)).toBe(
				false,
			);
		});

		it("looks the marker up for a row without one", async () => {
			expect(await readAs({ id: 1 }, lookup({ id: 1, managedBy: null }))).toBe(
				true,
			);
			expect(
				await readAs({ id: 1 }, lookup({ id: 1, managedBy: "flue:editor" })),
			).toBe(false);
			expect(
				await readAs(
					{ id: 1, managedBy: undefined },
					lookup({ id: 1, managedBy: "flue:editor" }),
				),
			).toBe(false);
			expect(await readAs({ id: 1 }, unused)).toBe(false);
		});
	});
});

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
	const validate = async (agent: FlueAgentConfig): Promise<string[]> => {
		const warnings: string[] = [];

		validateGrants(capabilityFields(keysOf(await applyPlugins())), [agent], {
			warn: (message) => {
				warnings.push(message);
			},
		});

		return warnings;
	};

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
