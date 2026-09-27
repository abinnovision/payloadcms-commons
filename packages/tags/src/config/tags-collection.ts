import {
	COLOR_FIELD,
	COLOR_FIELD_COMPONENT,
	isHexColor,
	TAG_TITLE_CELL_COMPONENT,
	TITLE_FIELD,
} from "../index.js";
import { colorFillHook, duplicateNameHook } from "./hooks.js";

import type { ColorFieldClientProps } from "../index.js";
import type { CollectionConfig, TextField } from "payload";

const colorField = (presets: readonly string[]): TextField => {
	const clientProps: ColorFieldClientProps = { presets };

	return {
		name: COLOR_FIELD,
		type: "text",
		label: { en: "Color", de: "Farbe" },
		validate: (value) =>
			value === null ||
			value === undefined ||
			value === "" ||
			isHexColor(value) ||
			"Enter a hex color, e.g. #3b82f6.",
		admin: {
			components: { Field: { path: COLOR_FIELD_COMPONENT, clientProps } },
		},
	};
};

/**
 * Builds the tags collection: a required, unique `name`, an optional hex
 * `color`, the duplicate-name and color-fill hooks, and Payload's default
 * access. `overrides` receives the result and returns the collection to
 * register.
 */
export const buildTagsCollection = (args: {
	slug: string;
	presets: readonly string[];
	overrides?: ((collection: CollectionConfig) => CollectionConfig) | undefined;
}): CollectionConfig => {
	const collection: CollectionConfig = {
		slug: args.slug,
		admin: {
			useAsTitle: TITLE_FIELD,
			defaultColumns: [TITLE_FIELD, COLOR_FIELD, "updatedAt"],
		},
		fields: [
			{
				name: TITLE_FIELD,
				type: "text",
				required: true,
				unique: true,
				index: true,
				admin: { components: { Cell: { path: TAG_TITLE_CELL_COMPONENT } } },
			},
			colorField(args.presets),
		],
		hooks: {
			beforeValidate: [duplicateNameHook],
			beforeChange: [colorFillHook],
		},
	};

	return args.overrides ? args.overrides(collection) : collection;
};
