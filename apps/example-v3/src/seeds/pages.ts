import { defineDummySeed } from "@abinnovision/payloadcms-dummy";

import type { DummyContext } from "@abinnovision/payloadcms-dummy";

/**
 * A Lexical editor state written by hand, so the seed can show the two richtext
 * seams without an editing session: a `callout` block node, which montage's
 * converters dispatch back into the registry, and a link node written by
 * `wayfinderLinkFeature`, which resolves through the mapping.
 *
 * The article is named by its slug rather than its id, so the state is a plain
 * literal that needs no document to exist yet, and the link resolves on the
 * replay pass once the article is written.
 *
 * The result is cast at the call site: the generated type describes the node
 * union Lexical produces, which is wider than anything worth restating here.
 * The ref itself is still typed, because `polyRef` returns one.
 */
const introContent = (ctx: DummyContext) => ({
	root: {
		type: "root",
		format: "",
		indent: 0,
		version: 1,
		direction: "ltr",
		children: [
			{
				type: "paragraph",
				format: "",
				indent: 0,
				version: 1,
				direction: "ltr",
				children: [
					{
						type: "text",
						detail: 0,
						format: 0,
						mode: "normal",
						style: "",
						text: "Every URL on this site is authored in the admin, including ",
						version: 1,
					},
					{
						type: "link",
						format: "",
						indent: 0,
						version: 3,
						direction: "ltr",
						fields: {
							link: {
								type: "reference",
								label: "Hello world",
								reference: ctx.polyRef("articles", "hello-world"),
							},
						},
						children: [
							{
								type: "text",
								detail: 0,
								format: 0,
								mode: "normal",
								style: "",
								text: "this one",
								version: 1,
							},
						],
					},
					{
						type: "text",
						detail: 0,
						format: 0,
						mode: "normal",
						style: "",
						text: ".",
						version: 1,
					},
				],
			},
			{
				type: "block",
				format: "",
				version: 2,
				fields: {
					blockType: "callout",
					tone: "info",
					body: "A block embedded in rich text, rendered by the same registry as the ones in the layout.",
				},
			},
		],
	},
});

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
								title: "Five packages, one site",
								subtitle:
									"Everything on this page is authored in the admin panel.",
								imageSize: "large",
							},
							{ blockType: "recent-posts-module", limit: 3 },
						],
					},
					{
						blockType: "rich-text-module",
						content: introContent(ctx) as never,
					},
				],
			},
			{ locales: { de: { title: "Startseite" } } },
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
			{ locales: { de: { title: "Das Team" } } },
		);
	},
});
