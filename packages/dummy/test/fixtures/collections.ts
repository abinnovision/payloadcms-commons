import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { calloutBlock, cardBlock } from "./blocks.js";

import type { CollectionConfig } from "payload";

/**
 * Outside the repo, so a run leaves nothing behind in the working tree, and
 * fresh per process: a directory shared between runs would make Payload rename
 * an upload around the file the last run left, and a spec asserting on a
 * filename would fail only on the second run.
 */
export const MEDIA_DIR = mkdtempSync(
	path.join(tmpdir(), "payloadcms-dummy-media-"),
);

export const users: CollectionConfig = {
	slug: "users",
	auth: true,
	fields: [],
};

/** The canonical case: a unique slug, drafts, a localized title and blocks. */
export const pages: CollectionConfig = {
	slug: "pages",
	trash: true,
	versions: { drafts: true },
	fields: [
		{ name: "slug", type: "text", required: true, unique: true, index: true },
		{ name: "title", type: "text", required: true, localized: true },
		{ name: "layout", type: "blocks", blocks: [cardBlock, calloutBlock] },
	],
};

/** Relationship shapes: hasMany, polymorphic, upload, and a localized array. */
export const posts: CollectionConfig = {
	slug: "posts",
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true, unique: true, index: true },
		{ name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
		{
			name: "related",
			type: "relationship",
			relationTo: ["pages", "posts"],
			hasMany: true,
		},
		{ name: "hero", type: "upload", relationTo: "media" },
		{
			name: "chapters",
			type: "array",
			localized: true,
			fields: [{ name: "heading", type: "text" }],
		},
	],
};

/** No slug field and no versions, the case apps/example actually has. */
export const tags: CollectionConfig = {
	slug: "tags",
	fields: [
		{ name: "name", type: "text", required: true, unique: true, index: true },
	],
};

/** Versions without drafts, so the writer must not pass a draft flag. */
export const snippets: CollectionConfig = {
	slug: "snippets",
	versions: true,
	fields: [
		{ name: "key", type: "text", required: true, unique: true, index: true },
		{ name: "body", type: "text" },
	],
};

/*
 * No `imageSizes`, `resizeOptions` or `focalPoint`, and the fixture config
 * passes no `sharp`: Payload needs an image processor only when it has to
 * resize or reformat. Adding any of them makes sharp a devDependency.
 */
export const media: CollectionConfig = {
	slug: "media",
	upload: { staticDir: MEDIA_DIR, mimeTypes: ["image/*"] },
	fields: [{ name: "alt", type: "text", localized: true }],
};

/** Half of a genuine mutual reference, for the replay pass. */
export const authors: CollectionConfig = {
	slug: "authors",
	fields: [
		{ name: "name", type: "text", required: true, unique: true, index: true },
		{ name: "featuredBook", type: "relationship", relationTo: "books" },
	],
};

export const books: CollectionConfig = {
	slug: "books",
	fields: [
		{ name: "title", type: "text", required: true, unique: true, index: true },
		{ name: "author", type: "relationship", relationTo: "authors" },
	],
};

/** Two unique fields, so the natural key cannot be derived. */
export const ambiguous: CollectionConfig = {
	slug: "ambiguous",
	fields: [
		{ name: "code", type: "text", unique: true },
		{ name: "label", type: "text", unique: true },
	],
};

/** No unique field at all, so a seed cannot identify it across runs. */
export const keyless: CollectionConfig = {
	slug: "keyless",
	fields: [{ name: "note", type: "text" }],
};
