import { describe, expect, it } from "vitest";

import {
	adoptTagsCollection,
	generateTagsCollection,
} from "./tags-collection.js";

import type { CollectionConfig } from "payload";

const field = (name: string, overrides: Record<string, unknown> = {}) => ({
	name,
	type: "text",
	...overrides,
});

/** Fixtures are plain data; Payload's `Field` union is asserted at the boundary. */
const asCollection = (value: object): CollectionConfig =>
	value as unknown as CollectionConfig;

describe("adoptTagsCollection", () => {
	const base: CollectionConfig = {
		slug: "tags",
		admin: { useAsTitle: "title" },
		access: { read: () => true },
		fields: [field("title", { required: true })],
		hooks: { beforeChange: [() => ({})] },
	} as unknown as CollectionConfig;

	it("throws when admin.useAsTitle is missing", () => {
		const collection = asCollection({ slug: "tags", fields: [field("title")] });

		expect(() => adoptTagsCollection(collection)).toThrow(/useAsTitle/);
	});

	it("throws when admin.useAsTitle does not name a top-level text field", () => {
		const collection = {
			slug: "tags",
			admin: { useAsTitle: "missing" },
			fields: [field("title")],
		} as unknown as CollectionConfig;

		expect(() => adoptTagsCollection(collection)).toThrow(/useAsTitle/);
	});

	it("throws when the named field is not a text field", () => {
		const collection = {
			slug: "tags",
			admin: { useAsTitle: "title" },
			fields: [{ name: "title", type: "number" }],
		} as unknown as CollectionConfig;

		expect(() => adoptTagsCollection(collection)).toThrow(/useAsTitle/);
	});

	it("adds a nullable color field when one is not already present", () => {
		const { collection } = adoptTagsCollection(base);
		const colorField = collection.fields.find(
			(f) => "name" in f && f.name === "color",
		);

		expect(colorField).toBeDefined();
		expect((colorField as { required?: boolean }).required).toBeUndefined();
	});

	it("gives the color field the title field and presets as clientProps", () => {
		const { collection } = adoptTagsCollection(base, ["#000000"]);
		const colorField = collection.fields.find(
			(f) => "name" in f && f.name === "color",
		) as { admin?: { components?: { Field?: unknown } } };

		expect(colorField.admin?.components?.Field).toEqual({
			path: "@abinnovision/payloadcms-tags/admin#ColorField",
			clientProps: { titleField: "title", presets: ["#000000"] },
		});
	});

	it("does not duplicate an existing color field", () => {
		const withColor = asCollection({
			...base,
			fields: [...base.fields, field("color")],
		});

		const { collection } = adoptTagsCollection(withColor);
		const colorFields = collection.fields.filter(
			(f) => "name" in f && f.name === "color",
		);

		expect(colorFields).toHaveLength(1);
	});

	it("throws when an existing color field is not type text", () => {
		const wrongType = asCollection({
			...base,
			fields: [...base.fields, field("color", { type: "number" })],
		});

		expect(() => adoptTagsCollection(wrongType)).toThrow(/not type "text"/);
	});

	it("swaps the title field's Cell without touching its other admin config", () => {
		const withDescription = asCollection({
			...base,
			fields: [
				field("title", {
					required: true,
					admin: { description: "The tag's name." },
				}),
			],
		});

		const { collection } = adoptTagsCollection(withDescription);
		const title = collection.fields.find(
			(f) => "name" in f && f.name === "title",
		) as { admin?: { components?: { Cell?: unknown }; description?: string } };

		expect(title.admin?.components?.Cell).toEqual({
			path: "@abinnovision/payloadcms-tags/admin#TagTitleCell",
		});
		expect(title.admin?.description).toBe("The tag's name.");
	});

	it("forces enableListViewSelectAPI off and reports when it was on", () => {
		const selectApiOn = asCollection({
			...base,
			admin: { ...base.admin, enableListViewSelectAPI: true },
		});

		const { collection, forcedSelectApiOff } = adoptTagsCollection(selectApiOn);

		expect(collection.admin?.enableListViewSelectAPI).toBe(false);
		expect(forcedSelectApiOff).toBe(true);
	});

	it("does not report a forced select API when it was already off", () => {
		const { forcedSelectApiOff } = adoptTagsCollection(base);

		expect(forcedSelectApiOff).toBe(false);
	});

	it("adds color to defaultColumns only when defaultColumns is already set", () => {
		const withColumns = asCollection({
			...base,
			admin: { ...base.admin, defaultColumns: ["title"] },
		});

		const { collection } = adoptTagsCollection(withColumns);
		const noColumns = adoptTagsCollection(base).collection;

		expect(collection.admin?.defaultColumns).toEqual(["title", "color"]);
		expect(noColumns.admin?.defaultColumns).toBeUndefined();
	});

	it("does not add color to defaultColumns twice", () => {
		const withColumns = asCollection({
			...base,
			admin: { ...base.admin, defaultColumns: ["title", "color"] },
		});

		const { collection } = adoptTagsCollection(withColumns);

		expect(collection.admin?.defaultColumns).toEqual(["title", "color"]);
	});

	it("keeps user access untouched", () => {
		const { collection } = adoptTagsCollection(base);

		expect(collection.access).toBe(base.access);
	});

	it("prepends the duplicate-title and color-fill hooks ahead of existing ones", () => {
		const { collection } = adoptTagsCollection(base);

		expect(collection.hooks?.beforeValidate).toHaveLength(1);
		expect(collection.hooks?.beforeChange).toHaveLength(2);
		expect(collection.hooks?.beforeChange?.[1]).toBe(
			base.hooks?.beforeChange?.[0],
		);
	});
});

describe("generateTagsCollection", () => {
	it("creates a required, unique, indexed name field and a color field", () => {
		const collection = generateTagsCollection("tags");
		const name = collection.fields.find(
			(f) => "name" in f && f.name === "name",
		) as { required?: boolean; unique?: boolean; index?: boolean };

		expect(name.required).toBe(true);
		expect(name.unique).toBe(true);
		expect(name.index).toBe(true);
		expect(
			collection.fields.some((f) => "name" in f && f.name === "color"),
		).toBe(true);
	});

	it("uses the given slug and Payload's default access", () => {
		const collection = generateTagsCollection("labels");

		expect(collection.slug).toBe("labels");
		expect(collection.access).toBeUndefined();
	});

	it("wires the same hooks an adopted collection gets", () => {
		const collection = generateTagsCollection("tags");

		expect(collection.hooks?.beforeValidate).toHaveLength(1);
		expect(collection.hooks?.beforeChange).toHaveLength(1);
	});
});
