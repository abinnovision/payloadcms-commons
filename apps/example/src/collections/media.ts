import path from "node:path";

import type { CollectionConfig } from "payload";

/**
 * An upload collection with `mimeTypes` set, which is what lets mcpx accept a
 * file for it: `createDocument` and `patchDocument` hand back a PUT target
 * instead of taking the bytes inline. The directory is gitignored.
 */
export const media: CollectionConfig = {
	slug: "media",
	admin: { useAsTitle: "alt" },
	upload: {
		staticDir: path.resolve(process.cwd(), ".data/media"),
		mimeTypes: ["image/*"],
	},
	fields: [{ name: "alt", type: "text", localized: true }],
};
