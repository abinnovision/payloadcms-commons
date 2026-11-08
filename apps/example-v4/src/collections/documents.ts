import path from "node:path";

import type { CollectionConfig } from "payload";

/**
 * Files the editor agent saves from a chat. Served as downloads in a
 * sandbox, since an agent wrote them. The directory is gitignored.
 */
export const documents: CollectionConfig = {
	slug: "documents",
	trash: true,
	admin: { useAsTitle: "filename" },
	upload: {
		staticDir: path.resolve(process.cwd(), ".data/documents"),
		mimeTypes: ["application/pdf", "text/markdown", "text/plain"],
		modifyResponseHeaders: ({ headers }) => {
			headers.set("Content-Disposition", "attachment");
			headers.set("Content-Security-Policy", "sandbox");

			return headers;
		},
	},
	fields: [],
	// Payload 4 enables versions by default; this collection keeps the v3 schema.
	versions: false,
};
