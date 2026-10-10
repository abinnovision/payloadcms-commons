import type { GlobalConfig } from "payload";

/** Drafts, a localized required field and a ref target. */
export const siteSettings: GlobalConfig = {
	slug: "site-settings",
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true, localized: true },
		{ name: "tagline", type: "text" },
		{ name: "homepage", type: "relationship", relationTo: "pages" },
	],
};

/** No versions, so a write goes live. */
export const banner: GlobalConfig = {
	slug: "banner",
	fields: [{ name: "message", type: "text" }],
};

/**
 * A shared row set with a localized leaf, which is wayfinder's mapping shape.
 *
 * The array is not localized, so every locale sees the same rows and only
 * `path` differs. This is the shape that loses the other locale's values when a
 * write arrives without the stored row ids.
 */
export const routes: GlobalConfig = {
	slug: "routes",
	fields: [
		{
			name: "entries",
			type: "array",
			fields: [
				{ name: "collectionName", type: "text" },
				{ name: "path", type: "text", localized: true },
			],
		},
	],
};

/** A localized array, where each locale owns its rows and their ids. */
export const menus: GlobalConfig = {
	slug: "menus",
	fields: [
		{
			name: "items",
			type: "array",
			localized: true,
			fields: [{ name: "label", type: "text" }],
		},
	],
};
