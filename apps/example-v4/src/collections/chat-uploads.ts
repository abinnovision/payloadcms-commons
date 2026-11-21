import { flueThreadScoped } from "@abinnovision/payloadcms-flue";
import path from "node:path";

import type { CollectionConfig } from "payload";

/**
 * Files users send the editor agent in the chat. Only the uploader reads
 * them; the agent reads the ones of its current thread. The directory is
 * gitignored.
 */
export const chatUploads: CollectionConfig = {
	slug: "chat-uploads",
	authorship: true,
	versions: false,
	admin: {
		hidden: true,
		enableRichTextRelationship: false,
	},
	upload: {
		staticDir: path.resolve(process.cwd(), ".data/chat-uploads"),
		mimeTypes: [
			"image/png",
			"image/jpeg",
			"image/gif",
			"image/webp",
			"application/pdf",
			"text/plain",
			"text/markdown",
			"text/csv",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		],
		pasteURL: false,
		crop: false,
		focalPoint: false,
	},
	access: {
		read: flueThreadScoped(),
		create: ({ req }) => req.user?.collection === "users",
		update: () => false,
		delete: flueThreadScoped(),
	},
	fields: [],
};
