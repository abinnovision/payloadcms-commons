import { createServerFeature, LinkFeature } from "@payloadcms/richtext-lexical";

import { linkField } from "../config/link-field.js";
import { resolveLink } from "../runtime/resolve-link.js";

import type { LinkFieldArgs } from "../config/link-field.js";
import type { LinkDeclaration } from "../pattern/define-links.js";
import type { LinkFieldData } from "../pattern/types.js";
import type { ResolveLinkArgs } from "../runtime/resolve-link.js";

/** Where the admin bundle finds the label plugin. */
const LABEL_FEATURE_CLIENT =
	"@abinnovision/payloadcms-wayfinder/admin#LinkLabelFeatureClient";

/**
 * Gives every created or edited link a top-level `label` derived from its
 * destination, so the floating link editor shows a useful hover preview
 * instead of a blank one.
 */
export const linkLabelFeature = createServerFeature({
	key: "wayfinder-link-label",
	feature: () => ({
		ClientFeature: LABEL_FEATURE_CLIENT,
		markdownTransformers: [],
	}),
});

/**
 * Replaces Lexical's link fields with the wayfinder link field, so links
 * written in rich text route through the collection mapping exactly like links
 * authored in a block.
 *
 * @param args The same arguments as the standalone link field.
 */
export const wayfinderLinkFeature = <
	TDeclaration extends LinkDeclaration = LinkDeclaration,
>(
	args: LinkFieldArgs<TDeclaration>,
): ReturnType<typeof LinkFeature> =>
	LinkFeature({ fields: () => [linkField(args)] });

/**
 * The two shapes a link node's fields arrive in.
 *
 * A node written by {@link wayfinderLinkFeature} nests the group under `link`.
 * A node written by Lexical's stock link feature stores `linkType` and `doc`
 * at the top level, which existing content will still hold.
 */
interface SerializedLinkFields {
	link?: LinkFieldData;
	linkType?: "custom" | "internal";
	url?: string | null;
	newTab?: boolean | null;
	doc?: { relationTo: string; value: string | { id: string } } | null;
}

/**
 * Normalises a link node's fields into the link field's own shape.
 *
 * @param fields The node's `fields` object.
 */
const normaliseNodeFields = (
	fields: SerializedLinkFields | undefined,
): LinkFieldData | undefined => {
	if (!fields) {
		return undefined;
	}

	if (fields.link) {
		return fields.link;
	}

	if (fields.linkType === "internal" && fields.doc) {
		return {
			type: "reference",
			reference: fields.doc,
			newTab: fields.newTab ?? null,
		};
	}

	if (fields.url) {
		return {
			type: "custom",
			url: fields.url,
			newTab: fields.newTab ?? null,
		};
	}

	return undefined;
};

/**
 * Resolves a rich-text link node to an href.
 *
 * Returns null when the node points nowhere resolvable, so a converter can
 * render the text without an anchor rather than emitting a dead one.
 *
 * @param args The node's fields plus the usual link-resolution arguments.
 */
export const resolveLinkNode = <
	TExtra = object,
	TDeclaration extends LinkDeclaration = LinkDeclaration,
>(
	args: Omit<ResolveLinkArgs<TExtra, TDeclaration>, "link"> & {
		fields: SerializedLinkFields | undefined;
	},
) => {
	const link = normaliseNodeFields(args.fields);

	return resolveLink({
		...args,
		link: link,
	});
};
