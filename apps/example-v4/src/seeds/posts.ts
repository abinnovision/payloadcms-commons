import { defineDummySeed } from "@abinnovision/payloadcms-dummy";

/**
 * Read by the recent-posts module's resolver rather than by a route.
 *
 * Payload 4 keeps `_status` per locale, and dummy publishes only the first
 * write, so each German write publishes its own locale.
 */
export const postsSeed = defineDummySeed({
	id: "posts",
	dependsOn: ["tags"],
	run: async (ctx) => {
		await ctx.doc(
			"posts",
			{
				title: "The first post",
				excerpt: "Seeded by dummy, tagged through a reference.",
				tags: [ctx.ref("tags", "Release notes")],
			},
			{
				locales: {
					de: {
						title: "Der erste Beitrag",
						excerpt: "Von dummy angelegt, über eine Referenz verschlagwortet.",
						_status: "published",
					},
				},
			},
		);
	},
});
