import { defineDummySeed } from "@abinnovision/payloadcms-dummy";

/** Read by the recent-posts module's resolver rather than by a route. */
export const postsSeed = defineDummySeed({
	id: "posts",
	dependsOn: ["tags"],
	run: async (ctx) => {
		await ctx.doc(
			"posts",
			{
				title: "The first post",
				excerpt: "Read by the recent-posts module's resolver.",
				tags: [ctx.ref("tags", "Release notes")],
			},
			{
				locales: {
					de: {
						title: "Der erste Beitrag",
						excerpt: "Vom Resolver des recent-posts-Moduls gelesen.",
					},
				},
			},
		);
	},
});
