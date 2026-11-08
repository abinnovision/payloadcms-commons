import { mcpxPlugin } from "@abinnovision/payloadcms-mcpx";
import { sqliteAdapter } from "@payloadcms/db-sqlite";

import { fluePlugin } from "../../src/index.js";

import type { FlueAgentConfig, FluePluginOptions } from "../../src/index.js";
import type { CollectionConfig, Config, PayloadRequest } from "payload";

export const SIDECAR_SECRET = "flue-fixture-sidecar-secret-0123456789";

/*
 * Users whose `agentAccess` box is ticked may chat with `restricted` and read
 * agent runs. The seed ticks it for one user.
 */
const trusted = ({ user }: PayloadRequest): boolean =>
	user?.collection === "users" &&
	"agentAccess" in user &&
	user.agentAccess === true;

const users: CollectionConfig = {
	slug: "users",
	auth: true,
	fields: [{ name: "agentAccess", type: "checkbox", defaultValue: false }],
};

// A second auth collection, whose ids collide with those of `users`.
const admins: CollectionConfig = { slug: "admins", auth: true, fields: [] };

const pages: CollectionConfig = {
	slug: "pages",
	versions: { drafts: true },
	fields: [{ name: "title", type: "text" }],
};

const posts: CollectionConfig = {
	slug: "posts",
	trash: true,
	fields: [{ name: "title", type: "text" }],
};

export const EDITOR: FlueAgentConfig = {
	slug: "editor",
	label: "Editor",
	capabilities: {
		collections: {
			pages: { read: true, write: true },
			posts: { read: true, delete: true },
		},
	},
};

export const RESTRICTED: FlueAgentConfig = {
	slug: "restricted",
	capabilities: { collections: { pages: { read: true } } },
	access: ({ req }) => trusted(req),
};

/**
 * The raw config the specs build: mcpx exposing `pages` and `posts` (deletes
 * approved per call) and flue with two agents, pointed at `sidecarUrl`.
 * `flue` replaces flue's options key by key.
 */
export const fixtureConfig = (args: {
	sidecarUrl: string;
	flue?: Partial<FluePluginOptions>;
}): Config => ({
	secret: "flue-test-secret",
	db: sqliteAdapter({ client: { url: ":memory:" } }),
	admin: { user: "users" },
	collections: [users, admins, pages, posts],
	plugins: [
		mcpxPlugin({
			collections: { pages: {}, posts: { delete: true } },
		}),
		fluePlugin({
			sidecar: { url: args.sidecarUrl, secret: SIDECAR_SECRET },
			agents: [EDITOR, RESTRICTED],
			threads: { readAgentRuns: trusted },
			...args.flue,
		}),
	],
	typescript: { autoGenerate: false },
	graphQL: { disable: true },
});
