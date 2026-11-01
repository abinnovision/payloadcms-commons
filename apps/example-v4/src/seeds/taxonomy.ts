import { defineDummySeed } from "@abinnovision/payloadcms-dummy";

/** The editor account, so `/admin` can be signed into after a fresh seed. */
export const usersSeed = defineDummySeed({
	id: "users",
	run: async (ctx) => {
		await ctx.doc("users", {
			email: "editor@example.com",
			password: "password",
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
