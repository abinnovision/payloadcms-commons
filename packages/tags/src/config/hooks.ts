import { ValidationError } from "payload";

import { COLOR_FIELD, colorForName, TITLE_FIELD } from "../index.js";

import type {
	CollectionBeforeChangeHook,
	CollectionBeforeValidateHook,
} from "payload";

/** A tags-collection document, loosely: only `id` and the named fields matter here. */
interface TagDoc {
	id: number | string;
	[key: string]: unknown;
}

/**
 * Trims the name and rejects a case-insensitive duplicate.
 *
 * `like` is used only as a loose pre-filter (Drizzle maps it to `ilike`,
 * which folds case on ASCII only), with the exact comparison done in JS. The
 * check runs on create, and on update only when the trimmed, lowercased name
 * changes, so renaming a tag's own casing does not collide with itself.
 */
export const duplicateNameHook: CollectionBeforeValidateHook<TagDoc> = async ({
	collection,
	data,
	operation,
	originalDoc,
	req,
}) => {
	const raw = data?.[TITLE_FIELD];
	if (typeof raw !== "string") {
		return data;
	}

	const trimmed = raw.trim();
	const needle = trimmed.toLowerCase();
	const next = { ...data, [TITLE_FIELD]: trimmed };

	const original = originalDoc?.[TITLE_FIELD];
	if (
		operation === "update" &&
		typeof original === "string" &&
		original.trim().toLowerCase() === needle
	) {
		return next;
	}

	const candidates = await req.payload.find({
		collection: collection.slug,
		where: { [TITLE_FIELD]: { like: trimmed } },
		pagination: false,
		overrideAccess: true,
		req,
	});

	const duplicate = candidates.docs.find((doc) => {
		if (originalDoc && doc.id === originalDoc.id) {
			return false;
		}

		const name: unknown = doc[TITLE_FIELD];

		return typeof name === "string" && name.trim().toLowerCase() === needle;
	});

	if (duplicate) {
		throw new ValidationError(
			{
				collection: collection.slug,
				errors: [
					{
						path: TITLE_FIELD,
						message: `A tag named "${trimmed}" already exists.`,
					},
				],
			},
			req.t,
		);
	}

	return next;
};

/**
 * Fills a missing color with a deterministic default derived from the name,
 * so a tag saved without touching `ColorField` still has something to render.
 *
 * `data` in a `beforeChange` hook is not merged with the existing document,
 * so a partial update (e.g. renaming only the tag) arrives without `color`
 * even though the document already has one. Falling back to `originalDoc`
 * keeps that color instead of replacing it with a fresh default.
 */
export const colorFillHook: CollectionBeforeChangeHook<TagDoc> = ({
	data,
	originalDoc,
}) => {
	const color =
		COLOR_FIELD in data ? data[COLOR_FIELD] : originalDoc?.[COLOR_FIELD];
	if (color) {
		return data;
	}

	const name = data[TITLE_FIELD] ?? originalDoc?.[TITLE_FIELD];
	if (typeof name !== "string" || name === "") {
		return data;
	}

	return { ...data, [COLOR_FIELD]: colorForName(name) };
};
