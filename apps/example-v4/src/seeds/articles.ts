import { defineDummySeed } from "@abinnovision/payloadcms-dummy";

/**
 * Addressed through its section, so its pattern takes two parameters.
 *
 * Payload 4 keeps `_status` per locale, and dummy publishes only the first
 * write, so each German write publishes its own locale.
 */
export const articlesSeed = defineDummySeed({
	id: "articles",
	dependsOn: ["sections"],
	run: async (ctx) => {
		await ctx.doc(
			"articles",
			{
				title: "Hello world",
				slug: "hello-world",
				section: ctx.ref("sections", "journal"),
				layout: [
					{
						blockType: "section-wrapper",
						identifier: "article",
						modules: [
							{
								blockType: "hero-module",
								title: "Hello world",
								subtitle: "An article, addressed through its section.",
							},
						],
					},
				],
			},
			{ locales: { de: { title: "Hallo Welt", _status: "published" } } },
		);
	},
});
