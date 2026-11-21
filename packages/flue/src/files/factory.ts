import { randomUUID } from "node:crypto";

import { ownerWhere } from "../threads/owner.js";

import type { CollectionBeforeOperationHook, CollectionConfig } from "payload";

export interface FluePrivateUploadsArgs {
	slug: string;
	/** The types Payload takes, checked against each file's content. */
	mimeTypes: string[];
	/** The auth collection of the chat's users, mcpx's user collection. Default `users`. */
	userCollection?: string;
	/** Merged over the collection, such as `upload.staticDir` or a storage adapter's fields. */
	overrides?: Partial<CollectionConfig>;
}

/** The `custom` key naming the user collection a factory-built collection admits. */
export const FACTORY_USER_COLLECTION = "flueUserCollection";

const NAME_MAX = 255;

// An extension Payload can still tell a text file's type from.
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

/*
 * Stores each file under a random name, so the collection-wide unique
 * filename reveals nothing about other users' files, and keeps the
 * uploader's name in `name`.
 */
const randomName: CollectionBeforeOperationHook = (hook) => {
	const { req } = hook;

	// eslint-disable-next-line @typescript-eslint/no-deprecated
	if (hook.operation !== "create" || !req.file) {
		return hook.args;
	}

	const { name } = req.file;
	const extension = EXTENSION.exec(name)?.[0].toLowerCase() ?? "";

	req.file = { ...req.file, name: `${randomUUID()}${extension}` };

	return {
		...hook.args,
		data: { ...hook.args.data, name: name.slice(0, NAME_MAX) },
	};
};

/**
 * An upload collection for chat files that only their uploader reads and
 * deletes and nobody updates, with `authorship` on, no uploads from a URL
 * and random stored names. Pass its slug as `files.collection`.
 */
export const fluePrivateUploads = ({
	slug,
	mimeTypes,
	userCollection = "users",
	overrides = {},
}: FluePrivateUploadsArgs): CollectionConfig => ({
	slug,
	authorship: true,
	versions: false,
	// Kept out of rich text upload and relationship pickers.
	admin: {
		hidden: true,
		useAsTitle: "name",
		enableRichTextRelationship: false,
	},
	...overrides,
	custom: { ...overrides.custom, [FACTORY_USER_COLLECTION]: userCollection },
	upload: {
		mimeTypes,
		pasteURL: false,
		crop: false,
		focalPoint: false,
		...(typeof overrides.upload === "object" ? overrides.upload : {}),
	},
	access: {
		read: ({ req }) => ownerWhere(req, userCollection),
		create: ({ req }) => req.user?.collection === userCollection,
		update: () => false,
		delete: ({ req }) => ownerWhere(req, userCollection),
		...overrides.access,
	},
	hooks: {
		...overrides.hooks,
		beforeOperation: [randomName, ...(overrides.hooks?.beforeOperation ?? [])],
	},
	fields: [
		{
			name: "name",
			type: "text",
			maxLength: NAME_MAX,
			admin: { readOnly: true },
			access: { update: () => false },
		},
		...(overrides.fields ?? []),
	],
});
