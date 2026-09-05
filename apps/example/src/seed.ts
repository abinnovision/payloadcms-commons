import config from "@payload-config";
import { getPayload } from "payload";

/*
 * Fills a fresh database with enough content to exercise every package at
 * once. The mapping rows are written last, because they are what makes
 * everything else reachable.
 *
 * Written as top-level await rather than a `main()` call: `payload run` stops
 * once the module finishes evaluating, so a floating promise never resumes.
 */
const payload = await getPayload({ config });

const existing = await payload.find({ collection: "users", limit: 1 });

if (existing.docs.length === 0) {
	await payload.create({
		collection: "users",
		data: { email: "editor@example.com", password: "password" },
	});
}

const tag = await payload.create({
	collection: "tags",
	data: { name: "Release notes" },
});

const post = await payload.create({
	collection: "posts",
	data: {
		title: "The first post",
		excerpt: "Read by the recent-posts module's resolver.",
		tags: [tag.id],
		_status: "published",
	},
});

await payload.update({
	collection: "posts",
	id: post.id,
	locale: "de",
	data: {
		title: "Der erste Beitrag",
		excerpt: "Vom Resolver des recent-posts-Moduls gelesen.",
	},
});

const section = await payload.create({
	collection: "sections",
	data: { title: "Journal", slug: "journal" },
});

const article = await payload.create({
	collection: "articles",
	data: {
		title: "Hello world",
		slug: "hello-world",
		section: section.id,
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
		_status: "published",
	},
});

await payload.update({
	collection: "articles",
	id: article.id,
	locale: "de",
	data: { title: "Hallo Welt" },
});

/*
 * A Lexical editor state written by hand, so the seed can show the two
 * richtext seams without an editing session: a `callout` block node, which
 * montage's converters dispatch back into the registry, and a link node
 * written by `wayfinderLinkFeature`, which resolves through the mapping.
 *
 * Cast because the generated type describes the node union Lexical produces,
 * which is wider than anything worth restating here.
 */
const introContent = {
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
								reference: { relationTo: "articles", value: article.id },
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
};

const home = await payload.create({
	collection: "pages",
	data: {
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
						subtitle: "Everything on this page is authored in the admin panel.",
						imageSize: "large",
					},
					{ blockType: "recent-posts-module", limit: 3 },
				],
			},
			{
				blockType: "rich-text-module",
				content: introContent as never,
			},
		],
		_status: "published",
	},
});

await payload.update({
	collection: "pages",
	id: home.id,
	locale: "de",
	data: { title: "Startseite" },
});

const team = await payload.create({
	collection: "pages",
	data: {
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
						subtitle: "A page nested two levels deep, served by the wildcard.",
					},
					{
						blockType: "call-to-action-module",
						heading: "Read the journal",
						link: {
							type: "reference",
							label: "Hello world",
							reference: { relationTo: "articles", value: article.id },
						},
					},
				],
			},
		],
		_status: "published",
	},
});

await payload.update({
	collection: "pages",
	id: team.id,
	locale: "de",
	data: { title: "Das Team" },
});

await payload.updateGlobal({
	slug: "site-settings",
	data: { title: "payloadcms-commons example", _status: "published" },
});

/*
 * The mapping is localized, so `path` is a per-locale field on a shared row.
 * The English patterns are written first, then the rows are read back and
 * rewritten in German by id: without the ids Payload would treat the second
 * write as a new set of rows and drop the English patterns with them.
 *
 * The German patterns carry no `/de` prefix. That belongs to the app's
 * `formatHref`, not to a pattern — see `src/locales.ts`.
 */
await payload.updateGlobal({
	slug: "collections-mapping",
	locale: "en",
	data: {
		collections: [
			{ collectionName: "pages", path: "/*slug" },
			{ collectionName: "sections", path: "/topic/:slug" },
			{ collectionName: "articles", path: "/:section/:slug" },
		],
	},
});

const mapping = (await payload.findGlobal({
	slug: "collections-mapping",
	locale: "en",
	depth: 0,
})) as { collections?: { id?: string | null; collectionName?: string }[] };

const germanPaths: Record<string, string> = {
	pages: "/*slug",
	sections: "/thema/:slug",
	articles: "/:section/:slug",
};

await payload.updateGlobal({
	slug: "collections-mapping",
	locale: "de",
	data: {
		collections: (mapping.collections ?? []).flatMap((row) => {
			const path = row.collectionName
				? germanPaths[row.collectionName]
				: undefined;

			return path && row.collectionName
				? [{ id: row.id ?? null, collectionName: row.collectionName, path }]
				: [];
		}),
	},
});

console.log("Seeded. Sign in at /admin as editor@example.com / password");
