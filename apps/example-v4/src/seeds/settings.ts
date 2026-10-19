import { defineDummySeed } from "@abinnovision/payloadcms-dummy";

export const siteSettingsSeed = defineDummySeed({
	id: "site-settings",
	run: async (ctx) => {
		await ctx.global("site-settings", {
			title: "payloadcms-commons example (Payload v4)",
		});
	},
});
