import { fluePrivateUploads } from "@abinnovision/payloadcms-flue";
import path from "node:path";

/**
 * Files users send the editor agent in the chat. Only the uploader reads
 * them; the agent reads the ones of its current thread. The directory is
 * gitignored.
 */
export const chatUploads = fluePrivateUploads({
	slug: "chat-uploads",
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
	overrides: {
		upload: { staticDir: path.resolve(process.cwd(), ".data/chat-uploads") },
	},
});
