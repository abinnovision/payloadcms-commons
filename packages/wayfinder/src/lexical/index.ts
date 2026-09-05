import { createServerFeature, LinkFeature } from "@payloadcms/richtext-lexical";

import { linkField } from "../config/link-field.js";
import { normaliseLinkNodeFields } from "../pattern/link-node.js";
import { resolveLink } from "../runtime/resolve-link.js";

import type { LinkFieldArgs } from "../config/link-field.js";
import type {
	LinkDeclaration,
	ResolvedLinkOf,
} from "../pattern/define-links.js";
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
 * Resolves a rich-text link node to an href.
 *
 * Takes the node's `fields` as `unknown`, because Lexical types them as an
 * open record and a narrower parameter would make every converter cast. The
 * two shapes a node can hold are unwrapped by
 * {@link normaliseLinkNodeFields}, so a link written in rich text and a link
 * authored in a block resolve through exactly the same call.
 *
 * Returns null when the node points nowhere resolvable, so a converter can
 * render the text without an anchor rather than emitting a dead one.
 *
 * @param args The node's fields plus the usual link-resolution arguments.
 */
export const resolveLinkNode = <
	TDeclaration extends LinkDeclaration = LinkDeclaration,
>(
	args: Omit<ResolveLinkArgs<TDeclaration>, "link"> & { fields: unknown },
): ResolvedLinkOf<TDeclaration> | null =>
	resolveLink({
		...args,
		link: normaliseLinkNodeFields(
			args.fields,
		) as ResolveLinkArgs<TDeclaration>["link"],
	});
