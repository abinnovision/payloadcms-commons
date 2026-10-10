import { defineDummySeed } from "@abinnovision/payloadcms-dummy";

export const siteSettingsSeed = defineDummySeed({
	id: "site-settings",
	dependsOn: ["pages"],
	run: async (ctx) => {
		await ctx.global("site-settings", {
			title: "payloadcms-commons example",
		});
	},
});

/**
 * The mapping is what makes everything else reachable, so it is written last.
 *
 * `path` is localized on a shared row, so the German write has to land on the
 * same rows as the English one. The writer grafts the stored row ids for that,
 * which is why the German patterns are just a second entry here rather than a
 * read-back-and-rewrite pass.
 *
 * The German patterns carry no `/de` prefix. That belongs to the app's
 * `formatHref`, not to a pattern: see `src/locales.ts`.
 */
export const mappingSeed = defineDummySeed({
	id: "collections-mapping",
	dependsOn: ["site-settings"],
	run: async (ctx) => {
		await ctx.global(
			"collections-mapping",
			{
				collections: [
					{ collectionName: "pages", path: "/*slug" },
					{ collectionName: "sections", path: "/topic/:slug" },
					{ collectionName: "articles", path: "/:section/:slug" },
				],
			},
			{
				locales: {
					de: {
						collections: [
							{ collectionName: "pages", path: "/*slug" },
							{ collectionName: "sections", path: "/thema/:slug" },
							{ collectionName: "articles", path: "/:section/:slug" },
						],
					},
				},
			},
		);
	},
});
