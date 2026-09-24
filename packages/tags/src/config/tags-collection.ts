import {
	COLOR_FIELD_COMPONENT,
	isHexColor,
	PRESETS,
	TAG_TITLE_CELL_COMPONENT,
} from "../index.js";
import { createColorFillHook, createDuplicateTitleHook } from "./hooks.js";

import type { ColorFieldClientProps } from "../index.js";
import type {
	CollectionConfig,
	Field,
	LabelFunction,
	TextField,
	Validate,
} from "payload";

const COLOR_FIELD = "color";

/**
 * The title field an adopted collection must name through
 * `admin.useAsTitle`: top-level, and of type `text` (localized is allowed;
 * the duplicate check then runs per locale).
 */
export const findTitleField = (collection: CollectionConfig): TextField => {
	const useAsTitle = collection.admin?.useAsTitle;
	const field =
		typeof useAsTitle === "string"
			? collection.fields.find(
					(candidate) => "name" in candidate && candidate.name === useAsTitle,
				)
			: undefined;

	if (!field || field.type !== "text") {
		throw new Error(
			`tagsPlugin: collection "${collection.slug}" must set \`admin.useAsTitle\` to a top-level text field.`,
		);
	}

	return field;
};

const validateColor: Validate<string | null | undefined> = (value) => {
	if (value === null || value === undefined || value === "") {
		return true;
	}

	return isHexColor(value) || "Enter a hex color, e.g. #3b82f6.";
};

const buildColorField = (
	titleField: string,
	presets: readonly string[],
): Field => {
	const clientProps: ColorFieldClientProps = { titleField, presets };

	return {
		name: COLOR_FIELD,
		type: "text",
		label: (({ t }) => t("tags:color" as never)) as LabelFunction,
		admin: {
			components: { Field: { path: COLOR_FIELD_COMPONENT, clientProps } },
		},
		validate: validateColor,
	} as unknown as Field;
};

const withTitleCell = (
	fields: CollectionConfig["fields"],
	titleField: string,
): CollectionConfig["fields"] =>
	fields.map((field) =>
		"name" in field && field.name === titleField
			? ({
					...field,
					admin: {
						...field.admin,
						components: {
							...field.admin?.components,
							Cell: { path: TAG_TITLE_CELL_COMPONENT },
						},
					},
				} as unknown as Field)
			: field,
	);

export interface AdoptResult {
	collection: CollectionConfig;
	/** Set when the collection already had `enableListViewSelectAPI: true`. */
	forcedSelectApiOff: boolean;
}

/**
 * Adopts an existing tags collection in place: adds a nullable `color` field
 * if missing, swaps the title field's list Cell for `TagTitleCell`, forces
 * `enableListViewSelectAPI` off (the field needs full documents, not just the
 * title `useListRelationships()` would otherwise be limited to), and prepends
 * the duplicate-title and color-fill hooks ahead of whatever the project
 * already defined. Access, other fields, `unique` and indexes are untouched.
 */
export const adoptTagsCollection = (
	collection: CollectionConfig,
	presets: readonly string[] = PRESETS,
): AdoptResult => {
	const titleField = findTitleField(collection);
	const existingColorField = collection.fields.find(
		(field) => "name" in field && field.name === COLOR_FIELD,
	);

	if (existingColorField && existingColorField.type !== "text") {
		throw new Error(
			`tagsPlugin: collection "${collection.slug}" has a "${COLOR_FIELD}" field that is not type "text".`,
		);
	}

	const fields = withTitleCell(
		existingColorField
			? collection.fields
			: [...collection.fields, buildColorField(titleField.name, presets)],
		titleField.name,
	);

	const defaultColumns = collection.admin?.defaultColumns;
	const defaultColumnsWithColor =
		defaultColumns === undefined
			? undefined
			: defaultColumns.includes(COLOR_FIELD)
				? defaultColumns
				: [...defaultColumns, COLOR_FIELD];

	const forcedSelectApiOff = collection.admin?.enableListViewSelectAPI === true;

	return {
		collection: {
			...collection,
			fields,
			admin: {
				...collection.admin,
				enableListViewSelectAPI: false,
				...(defaultColumnsWithColor
					? { defaultColumns: defaultColumnsWithColor }
					: {}),
			},
			hooks: {
				...collection.hooks,
				beforeValidate: [
					createDuplicateTitleHook(titleField.name),
					...(collection.hooks?.beforeValidate ?? []),
				],
				beforeChange: [
					createColorFillHook(titleField.name),
					...(collection.hooks?.beforeChange ?? []),
				],
			},
		},
		forcedSelectApiOff,
	};
};

/**
 * Generates a tags collection from scratch when the configured slug is
 * absent: a required, unique, indexed `name` plus the same `color` field and
 * hooks an adopted collection gets, and Payload's default access.
 */
export const generateTagsCollection = (
	slug: string,
	presets: readonly string[] = PRESETS,
): CollectionConfig => ({
	slug,
	admin: {
		useAsTitle: "name",
		enableListViewSelectAPI: false,
		defaultColumns: ["name", COLOR_FIELD],
	},
	fields: [
		{
			name: "name",
			type: "text",
			required: true,
			unique: true,
			index: true,
			admin: { components: { Cell: { path: TAG_TITLE_CELL_COMPONENT } } },
		} as unknown as Field,
		buildColorField("name", presets),
	],
	hooks: {
		beforeValidate: [createDuplicateTitleHook("name")],
		beforeChange: [createColorFillHook("name")],
	},
});
