import path from "node:path";

import type { CollectionConfig } from "payload";

/** The directory is gitignored. */
export const media: CollectionConfig = {
	slug: "media",
	trash: true,
	admin: { useAsTitle: "alt" },
	upload: {
		staticDir: path.resolve(process.cwd(), ".data/media"),
		mimeTypes: ["image/*"],
	},
	fields: [{ name: "alt", type: "text", localized: true }],
	// Payload 4 enables versions by default; this collection keeps the v3 schema.
	versions: false,
};
