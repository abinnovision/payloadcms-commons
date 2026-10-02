import type { Access, CollectionConfig, FieldAccess } from "payload";

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

/** Users without lockouts, so the collection has no `lockUntil` field. */
export const lockoutFreeUsers: CollectionConfig = {
	slug: "users",
	auth: { maxLoginAttempts: 0 },
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

/**
 * Relates to users under Payload's default access. `authorEmail` resolves
 * through that relation.
 */
export const articles: CollectionConfig = {
	slug: "articles",
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text" },
		{ name: "author", type: "relationship", relationTo: "users" },
		{ name: "authorEmail", type: "text", virtual: "author.email" },
		{ name: "notes", type: "json" },
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
 * Read access is a filter on the current state, so an old version may hold a
 * state the filter excludes. A slug and a `readVersions` rule make the variants.
 */
const bulletinCollection = (
	slug: string,
	readVersions?: Access,
): CollectionConfig => ({
	slug,
	versions: true,
	access: {
		read: () => ({ visibility: { equals: "public" } }),
		...(readVersions ? { readVersions } : {}),
	},
	fields: [
		{ name: "body", type: "text" },
		{
			name: "visibility",
			type: "select",
			options: ["public", "private"],
		},
	],
});

/** `readVersions` keeps Payload's default, which lets any logged-in user in. */
export const bulletins = bulletinCollection("bulletins");

/** The same as `bulletins`, for a spec that opts in to version history. */
export const openBulletins = bulletinCollection("open-bulletins");

/** `readVersions` applies the read filter to the version's own fields. */
export const guardedBulletins = bulletinCollection("guarded-bulletins", () => ({
	"version.visibility": { equals: "public" },
}));

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

/** The one user the `vaults` code field is open to. */
export const KEEPER_EMAIL = "keeper@example.com";

const keeperOnly: FieldAccess = ({ req }) => req.user?.email === KEEPER_EMAIL;

/** `code` is open for read and update to the keeper and closed to everyone else. */
export const vaults: CollectionConfig = {
	slug: "vaults",
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text" },
		{
			name: "code",
			type: "text",
			access: { read: keeperOnly, update: keeperOnly },
		},
	],
};

/**
 * Relates to users through every field shape Payload populates, to media
 * through an upload field, and to articles, which relate to users in turn.
 * The rich text field uses the config's default editor, which carries the
 * relationship, upload and link nodes.
 */
export const dispatches: CollectionConfig = {
	slug: "dispatches",
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text" },
		{
			name: "reviewers",
			type: "relationship",
			relationTo: "users",
			hasMany: true,
		},
		{
			name: "subjects",
			type: "relationship",
			relationTo: ["users", "articles"],
			hasMany: true,
		},
		{ name: "article", type: "relationship", relationTo: "articles" },
		{ name: "attachment", type: "upload", relationTo: "media" },
		{
			name: "meta",
			type: "group",
			fields: [{ name: "owner", type: "relationship", relationTo: "users" }],
		},
		{
			name: "entries",
			type: "array",
			fields: [{ name: "person", type: "relationship", relationTo: "users" }],
		},
		{
			name: "sections",
			type: "blocks",
			blocks: [
				{
					slug: "mention",
					fields: [
						{ name: "person", type: "relationship", relationTo: "users" },
					],
				},
			],
		},
		{ name: "body", type: "richText" },
		{ name: "remarks", type: "join", collection: "remarks", on: "dispatch" },
		{ name: "ownerEmail", type: "text", virtual: "article.author.email" },
	],
};

/** The other side of the join on `dispatches`. */
export const remarks: CollectionConfig = {
	slug: "remarks",
	fields: [
		{ name: "text", type: "text" },
		{ name: "dispatch", type: "relationship", relationTo: "dispatches" },
	],
};
