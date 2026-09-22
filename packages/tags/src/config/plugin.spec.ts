import { describe, expect, it, vi } from "vitest";

import { TAGS_CELL_COMPONENT, TAGS_FIELD_COMPONENT } from "../index.js";
import { tagsPlugin } from "./plugin.js";

import type { CollectionConfig, Config, Payload } from "payload";

const titleField = (name = "title") => ({ name, type: "text", required: true });

const tags = (overrides: Partial<CollectionConfig> = {}): CollectionConfig =>
	({
		slug: "tags",
		admin: { useAsTitle: "title" },
		fields: [titleField()],
		...overrides,
	}) as unknown as CollectionConfig;

const posts = (overrides: Partial<CollectionConfig> = {}): CollectionConfig =>
	({
		slug: "posts",
		fields: [{ name: "title", type: "text" }],
		...overrides,
	}) as unknown as CollectionConfig;

const run = (
	collections: CollectionConfig[],
	args: Parameters<typeof tagsPlugin>[0],
	configOverrides: Partial<Config> = {},
): Config =>
	tagsPlugin(args)({
		collections,
		...configOverrides,
	} as unknown as Config) as Config;

const field = (collection: CollectionConfig, name: string) =>
	collection.fields.find((f) => "name" in f && f.name === name) as {
		admin?: {
			components?: { Field?: unknown; Cell?: unknown };
			position?: string;
		};
		type?: string;
		relationTo?: string;
		hasMany?: boolean;
	};

describe("tagsPlugin", () => {
	it("throws for an unknown collection", () => {
		expect(() => run([tags()], { collections: ["missing"] })).toThrow(
			/unknown collection "missing"/,
		);
	});

	it("appends a sidebar hasMany relationship when the field is absent", () => {
		const config = run([tags(), posts()], { collections: ["posts"] });
		const postsCollection = config.collections!.find(
			(c) => c.slug === "posts",
		)!;
		const tagsField = field(postsCollection, "tags");

		expect(tagsField.type).toBe("relationship");
		expect(tagsField.relationTo).toBe("tags");
		expect(tagsField.hasMany).toBe(true);
		expect(tagsField.admin?.position).toBe("sidebar");
		expect(tagsField.admin?.components?.Field).toEqual({
			path: TAGS_FIELD_COMPONENT,
			clientProps: {
				tagsSlug: "tags",
				titleField: "title",
				presets: expect.any(Array),
			},
		});
	});

	it("upgrades an existing hasMany relationship to the tags slug in place", () => {
		const withField = posts({
			fields: [
				{ name: "title", type: "text" },
				{
					name: "tags",
					type: "relationship",
					relationTo: "tags",
					hasMany: true,
					access: { read: () => true },
				},
			],
		});

		const config = run([tags(), withField], { collections: ["posts"] });
		const postsCollection = config.collections!.find(
			(c) => c.slug === "posts",
		)!;
		const tagsField = field(postsCollection, "tags");

		expect(tagsField.admin?.components?.Field).toBeDefined();
		expect(tagsField.admin?.components?.Cell).toBeDefined();
		expect(
			(
				postsCollection.fields.find(
					(f) => "name" in f && f.name === "tags",
				) as {
					access?: unknown;
				}
			).access,
		).toBeDefined();
	});

	it("swaps only the Cell when allowInlineCreate is false", () => {
		const withField = posts({
			fields: [
				{
					name: "tags",
					type: "relationship",
					relationTo: "tags",
					hasMany: true,
				},
			],
		});

		const config = run([tags(), withField], {
			collections: ["posts"],
			allowInlineCreate: false,
		});
		const postsCollection = config.collections!.find(
			(c) => c.slug === "posts",
		)!;
		const tagsField = field(postsCollection, "tags");

		expect(tagsField.admin?.components?.Field).toBeUndefined();
		expect(tagsField.admin?.components?.Cell).toEqual({
			path: TAGS_CELL_COMPONENT,
			clientProps: { tagsSlug: "tags", titleField: "title" },
		});
	});

	const withUnsupportedUiProps = () =>
		posts({
			fields: [
				{
					name: "tags",
					type: "relationship",
					relationTo: "tags",
					hasMany: true,
					filterOptions: () => true,
					admin: { appearance: "drawer", sortOptions: "title" },
				},
			],
		});

	it("warns about unsupported UI props when allowInlineCreate is true", async () => {
		const warn = vi.fn();
		const config = run([tags(), withUnsupportedUiProps()], {
			collections: ["posts"],
		});

		await config.onInit!({ logger: { warn } } as unknown as Payload);

		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(
				/filterOptions.*admin\.appearance.*admin\.sortOptions/,
			),
		);
	});

	it("does not warn about unsupported UI props when allowInlineCreate is false", async () => {
		const warn = vi.fn();
		const config = run([tags(), withUnsupportedUiProps()], {
			collections: ["posts"],
			allowInlineCreate: false,
		});

		await config.onInit!({ logger: { warn } } as unknown as Payload);

		expect(warn).not.toHaveBeenCalled();
	});

	it("throws when the existing field is not a hasMany relationship to the tags slug", () => {
		const wrongShape = posts({ fields: [{ name: "tags", type: "text" }] });

		expect(() => run([tags(), wrongShape], { collections: ["posts"] })).toThrow(
			/must be a `hasMany` relationship/,
		);
	});

	it("respects a custom fieldName and tagsSlug", () => {
		const labels = tags({ slug: "labels" });
		const withField = posts({
			fields: [
				{
					name: "labels",
					type: "relationship",
					relationTo: "labels",
					hasMany: true,
				},
			],
		});

		const config = run([labels, withField], {
			collections: ["posts"],
			fieldName: "labels",
			tagsSlug: "labels",
		});
		const postsCollection = config.collections!.find(
			(c) => c.slug === "posts",
		)!;

		expect(
			field(postsCollection, "labels").admin?.components?.Field,
		).toBeDefined();
	});

	it("generates a tags collection when the slug is absent", () => {
		const config = run([posts()], { collections: ["posts"] });

		expect(config.collections!.some((c) => c.slug === "tags")).toBe(true);
	});

	it("adopts an existing tags collection instead of replacing it", () => {
		const access = { read: () => true };
		const config = run([tags({ access }), posts()], { collections: ["posts"] });
		const tagsCollection = config.collections!.find((c) => c.slug === "tags")!;

		expect(tagsCollection.access).toBe(access);
	});

	it("merges i18n translations without overwriting a project's own", () => {
		const config = run(
			[tags(), posts()],
			{ collections: ["posts"] },
			{
				i18n: { translations: { en: { tags: { create: "Add" } } } },
			},
		);

		expect(config.i18n?.translations).toMatchObject({
			en: { tags: { create: "Add", color: "Color" } },
		});
	});

	it("chains an existing onInit and warns about a forced select API", async () => {
		const existingOnInit = vi.fn();
		const warn = vi.fn();
		const selectApiOn = tags({
			admin: { useAsTitle: "title", enableListViewSelectAPI: true },
		});

		const config = run(
			[selectApiOn, posts()],
			{ collections: ["posts"] },
			{
				onInit: existingOnInit,
			},
		);

		const payload = { logger: { warn } } as unknown as Payload;
		await config.onInit!(payload);

		expect(existingOnInit).toHaveBeenCalledWith(payload);
		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/enableListViewSelectAPI/),
		);
	});

	it("identifies itself to Payload", () => {
		expect(tagsPlugin({ collections: [] }).slug).toBe("tags");
	});
});
