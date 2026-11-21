import { flueThreadScoped } from "@abinnovision/payloadcms-flue";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type {
	Access,
	CollectionBeforeOperationHook,
	CollectionConfig,
} from "payload";

// The files the requesting user uploaded.
const ownFiles: Access = ({ req }) =>
	req.user?.collection === "users"
		? {
				and: [
					{ "createdBy.relationTo": { equals: "users" } },
					{ "createdBy.value": { equals: req.user.id } },
				],
			}
		: false;

// Stores each file under a random name and keeps the uploader's in `name`.
const randomName: CollectionBeforeOperationHook = (hook) => {
	const { req } = hook;

	// eslint-disable-next-line @typescript-eslint/no-deprecated
	if (hook.operation !== "create" || !req.file) {
		return hook.args;
	}

	const { name } = req.file;
	const extension = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0].toLowerCase() ?? "";

	req.file = { ...req.file, name: `${randomUUID()}${extension}` };

	return {
		...hook.args,
		data: { ...hook.args.data, name: name.slice(0, 255) },
	};
};

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
		useAsTitle: "name",
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
		read: flueThreadScoped(ownFiles),
		create: ({ req }) => req.user?.collection === "users",
		update: () => false,
		delete: flueThreadScoped(ownFiles),
	},
	hooks: { beforeOperation: [randomName] },
	fields: [
		{
			name: "name",
			type: "text",
			maxLength: 255,
			admin: { readOnly: true },
			access: { update: () => false },
		},
	],
};
