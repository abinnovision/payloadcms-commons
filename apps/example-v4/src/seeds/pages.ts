import { defineDummySeed } from "@abinnovision/payloadcms-dummy";
import { h, link, p, richText } from "@abinnovision/payloadcms-dummy/lexical";

/** The rich text is built with dummy's Lexical helpers, links included. */
export const pagesSeed = defineDummySeed({
	id: "pages",
	dependsOn: ["posts"],
	run: async (ctx) => {
		await ctx.doc(
			"pages",
			{
				title: "Home",
				slug: "/",
				content: richText(
					h("h1", "Payload v4"),
					p(
						"Seeded by dummy, with an internal link to ",
						link(ctx.ref("posts", "The first post"), "the first post"),
						".",
					),
				) as never,
			},
			{ locales: { de: { title: "Startseite" } } },
		);
	},
});
