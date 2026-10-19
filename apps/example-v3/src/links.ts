import { defineLinks } from "@abinnovision/payloadcms-wayfinder";

import type { LinkFieldArgs } from "@abinnovision/payloadcms-wayfinder/config";

/** What a variant's resolver is handed at render time. */
export interface LinkContext {
	filesBase: string;
}

/**
 * The link types this site offers.
 *
 * Declared once and passed to every place a link is handled: the field an
 * editor fills in, the resolver that turns it into an href, and the rich-text
 * feature. The field types below are derived from the `fields` array, so
 * renaming one breaks its readers rather than silently returning undefined.
 */
export const links = defineLinks<LinkContext>()((variant) => ({
	variants: {
		download: variant({
			label: "Download",
			fields: [
				{ name: "fileName", type: "text" },
				{ name: "inline", type: "checkbox" },
			],
		}).resolve(({ link, context }) => {
			if (!link.fileName) {
				return null;
			}

			// `link.fileName` is string | null | undefined, off the field alone.
			return {
				href: `${context.filesBase}/${link.fileName}`,
				download: link.inline !== true,
			};
		}),
	},
}));

/**
 * What every link field in this app offers.
 *
 * Declared once because the field an editor fills in and the rich-text feature
 * have to agree: a collection linkable in one and not the other is a link an
 * editor can author in a block and not in prose, for no reason they can see.
 */
export const linkTargets = {
	relationTo: ["pages", "articles", "sections"],
	withLabel: true,
	links,
} satisfies LinkFieldArgs<typeof links>;
