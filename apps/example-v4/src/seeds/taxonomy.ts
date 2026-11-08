import { defineDummySeed } from "@abinnovision/payloadcms-dummy";
import { randomBytes } from "node:crypto";

/**
 * The editor account, so `/admin` can be signed into after a fresh seed; the
 * reviewer, whose agent access shows the reviewer agent and agent runs; and
 * the agent user that reactive runs act as, which nobody signs in as.
 */
export const usersSeed = defineDummySeed({
	id: "users",
	run: async (ctx) => {
		await ctx.doc("users", {
			email: "editor@example.com",
			password: "password",
		});
		await ctx.doc("users", {
			email: "reviewer@example.com",
			password: "password",
			agentAccess: true,
		});
		await ctx.doc("users", {
			email: "agent@example.com",
			password: randomBytes(32).toString("base64url"),
		});
	},
});

export const tagsSeed = defineDummySeed({
	id: "tags",
	run: async (ctx) => {
		await ctx.doc("tags", { name: "Release notes" });
	},
});

/** Sections group articles, which is what makes `/:section/:slug` resolve. */
export const sectionsSeed = defineDummySeed({
	id: "sections",
	run: async (ctx) => {
		await ctx.doc("sections", { title: "Journal", slug: "journal" });
	},
});
