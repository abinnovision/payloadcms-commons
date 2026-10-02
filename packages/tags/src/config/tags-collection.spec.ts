import { describe, expect, it } from "vitest";

import { buildTagsCollection } from "./tags-collection.js";
import {
	COLOR_FIELD_COMPONENT,
	PRESETS,
	TAG_TITLE_CELL_COMPONENT,
} from "../index.js";

import type { CollectionConfig } from "payload";

const findField = (collection: CollectionConfig, name: string) =>
	collection.fields.find((field) => "name" in field && field.name === name);

describe("buildTagsCollection", () => {
	const collection = buildTagsCollection({ slug: "labels", presets: PRESETS });

	it("uses the given slug and Payload's default access", () => {
		expect(collection.slug).toBe("labels");
		expect(collection.access).toBeUndefined();
	});

	it("creates a required, unique, indexed name with the title cell", () => {
		expect(findField(collection, "name")).toMatchObject({
			type: "text",
			required: true,
			unique: true,
			index: true,
			admin: { components: { Cell: { path: TAG_TITLE_CELL_COMPONENT } } },
		});
	});

	it("creates an optional color field with the presets as clientProps", () => {
		const color = findField(
			buildTagsCollection({ slug: "tags", presets: ["#000000"] }),
			"color",
		);

		expect(color).toMatchObject({
			type: "text",
			label: { en: "Color", de: "Farbe" },
			admin: {
				components: {
					Field: {
						path: COLOR_FIELD_COMPONENT,
						clientProps: { presets: ["#000000"] },
					},
				},
			},
		});
		expect(color).not.toHaveProperty("required");
	});

	it("accepts an empty or hex color and rejects anything else", () => {
		// The validator ignores its options, so only the value is passed.
		const { validate } = findField(collection, "color") as {
			validate: (value: unknown) => unknown;
		};

		for (const value of [null, undefined, "", "#3b82f6"]) {
			expect(validate(value)).toBe(true);
		}

		expect(validate("blue")).toBeTypeOf("string");
	});

	it("lists by name and color", () => {
		expect(collection.admin).toEqual({
			useAsTitle: "name",
			defaultColumns: ["name", "color", "updatedAt"],
		});
	});

	it("wires the duplicate-name and color-fill hooks", () => {
		expect(collection.hooks?.beforeValidate).toHaveLength(1);
		expect(collection.hooks?.beforeChange).toHaveLength(1);
	});

	it("registers what overrides returns", () => {
		const overridden = buildTagsCollection({
			slug: "tags",
			presets: PRESETS,
			overrides: (generated) => ({
				...generated,
				admin: { ...generated.admin, group: "Content" },
			}),
		});

		expect(overridden.admin?.group).toBe("Content");
		expect(overridden.admin?.useAsTitle).toBe("name");
	});
});
