import type { LinkFieldData, LinkVariant } from "./types.js";

/**
 * Derives a short destination hint for a link.
 *
 * Payload's floating link editor builds its hover preview from a top-level
 * `label` / `url`, neither of which a nested link group populates on its own,
 * so without this the preview is blank for every link.
 *
 * The hint describes where the link points rather than what it says. Anchor
 * text would look like a resolved title while telling an editor nothing about
 * the destination.
 *
 * Lives in the pure layer because both the editor feature and the admin
 * component need it, and neither may import the other.
 *
 * @param link The nested link group of a link node.
 * @param variants App-declared link types, which may describe themselves.
 */
export const deriveLinkLabel = <TCtx, TExtra>(
	link: LinkFieldData<string, TExtra>,
	variants?: LinkVariant<TCtx, TExtra>[],
): string | undefined => {
	switch (link.type) {
		case "custom":
			// Covers `https://…` and `mailto:…` alike.
			return link.url ?? undefined;

		case "reference": {
			if (!link.reference) {
				return undefined;
			}

			const { relationTo, value } = link.reference;
			const id = typeof value === "object" ? value.id : value;

			return `${relationTo}/${id}`;
		}

		case "same-page":
			return link.samePageIdentifier
				? `#${link.samePageIdentifier}`
				: undefined;

		case "none":
		case undefined:
		case null:
			return undefined;

		default: {
			/*
			 * An app-declared variant. Its own value is the only thing the
			 * package can say about it without knowing its fields.
			 */
			const variant = variants?.find((it) => it.value === link.type);

			return variant?.value;
		}
	}
};
