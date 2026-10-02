import type { Access, CollectionConfig } from "payload";

/*
 * Collections for the security specs. None of them is part of the default
 * fixture config: each spec passes the ones it needs to `bootPayload`.
 */

/** Users with email verification, so an unverified user exists to refuse. */
export const verifiedUsers: CollectionConfig = {
	slug: "users",
	auth: { verify: true },
	fields: [],
};

/** Users that can carry a Payload API key of their own. */
export const apiKeyUsers: CollectionConfig = {
	slug: "users",
	auth: { useAPIKey: true },
	fields: [],
};

const ownDocsOnly: Access = ({ req }) =>
	req.user ? { owner: { equals: req.user.id } } : false;

/** Each user may read only the documents they own. */
export const diaries: CollectionConfig = {
	slug: "diaries",
	versions: { drafts: true },
	access: { read: ownDocsOnly },
	fields: [
		{ name: "title", type: "text" },
		{ name: "owner", type: "relationship", relationTo: "users" },
	],
};

/** Relates to users under Payload's default access. */
export const articles: CollectionConfig = {
	slug: "articles",
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text" },
		{ name: "author", type: "relationship", relationTo: "users" },
	],
};

/** One field hidden from the admin panel, one hidden from the API. */
export const dossiers: CollectionConfig = {
	slug: "dossiers",
	fields: [
		{ name: "title", type: "text" },
		{ name: "adminHidden", type: "text", admin: { hidden: true } },
		{ name: "apiHidden", type: "text", hidden: true },
	],
};

/**
 * Read access is a filter on the current state, and `readVersions` keeps
 * Payload's default, so an old version may hold a state the filter excludes.
 */
export const bulletins: CollectionConfig = {
	slug: "bulletins",
	versions: true,
	access: { read: () => ({ visibility: { equals: "public" } }) },
	fields: [
		{ name: "body", type: "text" },
		{
			name: "visibility",
			type: "select",
			options: ["public", "private"],
		},
	],
};

/**
 * `secret` is closed to every user for read and update; a frozen document
 * refuses every update.
 */
export const ledgers: CollectionConfig = {
	slug: "ledgers",
	versions: { drafts: true },
	access: { update: () => ({ frozen: { not_equals: true } }) },
	fields: [
		{ name: "title", type: "text" },
		{
			name: "secret",
			type: "text",
			access: { read: () => false, update: () => false },
		},
		{ name: "frozen", type: "checkbox" },
	],
};
