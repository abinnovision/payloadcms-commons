import type { LinkFieldData } from "./types.js";

/**
 * Normalises a rich-text link node's `fields` into the link field's own shape.
 *
 * Lives in the pure layer, and takes `unknown`, for two reasons that turn out
 * to be the same one. Lexical types a node's `fields` as an open record whose
 * values are `unknown`, so nothing named here is assignable from it and every
 * caller would otherwise cast at the boundary. And the two shapes a link node
 * arrives in are a question about stored data, not about the editor, so
 * answering it needs no Lexical import and no rich-text peer.
 *
 * A node written by the wayfinder link feature nests the group under `link`.
 * A node written by Lexical's stock link feature stores `linkType` and `doc`
 * at the top level, which existing content still holds.
 *
 * @param fields The node's `fields` object, in whatever shape it arrived.
 */
export const normaliseLinkNodeFields = (
	fields: unknown,
): LinkFieldData | undefined => {
	if (!fields || typeof fields !== "object") {
		return undefined;
	}

	const it = fields as Record<string, unknown>;

	if (it["link"] && typeof it["link"] === "object") {
		return it["link"];
	}

	const newTab = typeof it["newTab"] === "boolean" ? it["newTab"] : null;

	if (
		it["linkType"] === "internal" &&
		it["doc"] &&
		typeof it["doc"] === "object"
	) {
		return {
			type: "reference",
			reference: it["doc"] as NonNullable<LinkFieldData["reference"]>,
			newTab,
		};
	}

	if (typeof it["url"] === "string") {
		return { type: "custom", url: it["url"], newTab };
	}

	return undefined;
};
