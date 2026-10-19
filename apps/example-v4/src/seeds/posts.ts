import { defineDummySeed } from "@abinnovision/payloadcms-dummy";

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
					},
				},
			},
		);
	},
});
