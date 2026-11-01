import { defineDummySeed } from "@abinnovision/payloadcms-dummy";
import {
	block,
	createLink,
	p,
	richText,
} from "@abinnovision/payloadcms-dummy/lexical";

/**
 * A link node in the shape `wayfinderLinkFeature` writes, so it resolves
 * through the mapping like a link authored in a field. The label is required
 * because the link targets declare `withLabel`.
 *
 * The target is a polymorphic ref, which the runner resolves on the replay
 * pass once the article is written.
 */
const referenceLink = (label: string) =>
	createLink((to) => ({ link: { type: "reference", label, reference: to } }));

/**
 * The rich text is built with dummy's Lexical helpers, and shows the two
 * richtext seams: a `callout` block node, which montage's converters dispatch
 * back into the registry, and a wayfinder link node.
 *
 * Payload 4 keeps `_status` per locale, and dummy publishes only the first
 * write, so each German write publishes its own locale.
 */
export const pagesSeed = defineDummySeed({
	id: "pages",
	dependsOn: ["articles"],
	run: async (ctx) => {
		await ctx.doc(
			"pages",
			{
				title: "Home",
				slug: "/",
				layout: [
					{
						blockType: "section-wrapper",
						identifier: "intro",
						modules: [
							{
								blockType: "hero-module",
								title: "Payload v4, one site",
								subtitle:
									"Everything on this page is authored in the admin panel.",
								imageSize: "large",
							},
							{ blockType: "recent-posts-module", limit: 3 },
						],
					},
					{
						blockType: "rich-text-module",
						content: richText(
							p(
								"Every URL on this site is authored in the admin, including ",
								referenceLink("Hello world")(
									ctx.polyRef("articles", "hello-world"),
									"this one",
								),
								".",
							),
							block("callout", {
								tone: "info",
								body: "A block embedded in rich text, rendered by the same registry as the ones in the layout.",
							}),
						) as never,
					},
				],
			},
			{ locales: { de: { title: "Startseite", _status: "published" } } },
		);

		await ctx.doc(
			"pages",
			{
				title: "The team",
				slug: "/about/team",
				layout: [
					{
						blockType: "section-wrapper",
						identifier: "team",
						modules: [
							{
								blockType: "hero-module",
								title: "The team",
								subtitle:
									"A page nested two levels deep, served by the wildcard.",
							},
							{
								blockType: "call-to-action-module",
								heading: "Read the journal",
								link: {
									type: "reference",
									label: "Hello world",
									reference: ctx.polyRef("articles", "hello-world"),
								},
							},
						],
					},
				],
			},
			{ locales: { de: { title: "Das Team", _status: "published" } } },
		);
	},
});
