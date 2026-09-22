import { ValidationError } from "payload";

import { colorForName } from "../index.js";

import type {
	CollectionBeforeChangeHook,
	CollectionBeforeValidateHook,
} from "payload";

const COLOR_FIELD = "color";

/** A tags-collection document, loosely: only `id` and the named fields matter here. */
interface TagDoc {
	id: number | string;
	[key: string]: unknown;
}

/**
 * Trims the title and rejects a case-insensitive duplicate.
 *
 * `like` is used only as a loose pre-filter (Drizzle maps it to `ilike`,
 * which folds case on ASCII only), with the real, exact comparison done in
 * JS. The check runs on create, and on update only when the trimmed title
 * actually changed, so a `News`/`news` pair that already exists side by side
 * stays editable without tripping over itself.
 */
export const createDuplicateTitleHook = (
	titleField: string,
): CollectionBeforeValidateHook<TagDoc> => {
	return async ({ collection, data, operation, originalDoc, req }) => {
		const raw = data?.[titleField];
		if (typeof raw !== "string") {
			return data;
		}

		const trimmed = raw.trim();
		const next = { ...data, [titleField]: trimmed };

		const originalTitle =
			typeof originalDoc?.[titleField] === "string"
				? originalDoc[titleField].trim()
				: undefined;
		const titleUnchanged =
			operation === "update" &&
			originalTitle !== undefined &&
			originalTitle.toLowerCase() === trimmed.toLowerCase();

		if (titleUnchanged) {
			return next;
		}

		const needle = trimmed.toLowerCase();
		const candidates = (await req.payload.find({
			collection: collection.slug as never,
			where: { [titleField]: { like: trimmed } },
			pagination: false,
			overrideAccess: true,
			req,
		})) as unknown as { docs: TagDoc[] };

		const duplicate = candidates.docs.find((doc) => {
			if (originalDoc && doc.id === originalDoc.id) {
				return false;
			}

			const docTitle = doc[titleField];

			return (
				typeof docTitle === "string" && docTitle.trim().toLowerCase() === needle
			);
		});

		if (duplicate) {
			throw new ValidationError(
				{
					collection: collection.slug,
					errors: [
						{
							path: titleField,
							message: `A tag named "${trimmed}" already exists.`,
						},
					],
				},
				req.t,
			);
		}

		return next;
	};
};

/**
 * Fills a missing color with a deterministic default derived from the title,
 * so a row saved without ever touching `ColorField`, including every row an
 * adopted collection already had, still has something to render.
 *
 * `data` in a `beforeChange` hook is not merged with the existing document in
 * Payload 3.89, so a partial update (e.g. renaming only the title) arrives
 * without `color` even though the document already has one. Falling back to
 * `originalDoc` avoids overwriting that existing color with a fresh
 * name-derived default.
 */
export const createColorFillHook = (
	titleField: string,
): CollectionBeforeChangeHook<TagDoc> => {
	return ({ data, originalDoc }) => {
		const color =
			COLOR_FIELD in data ? data[COLOR_FIELD] : originalDoc?.[COLOR_FIELD];
		if (color) {
			return data;
		}

		const title = data[titleField];
		if (typeof title !== "string" || title === "") {
			return data;
		}

		return { ...data, [COLOR_FIELD]: colorForName(title) };
	};
};
