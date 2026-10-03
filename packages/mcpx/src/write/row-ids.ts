import { isPlainObject } from "../guards.js";

import type { JsonObject } from "payload";

// A rich text state's nodes manage their own ids, so it is never descended into.
const isRichTextState = (value: Record<string, unknown>): boolean =>
	isPlainObject(value["root"]) && Array.isArray(value["root"]["children"]);

// A row is a plain object carrying `blockType`, or one sitting in an array.
const walkRows = (
	value: unknown,
	visit: (row: Record<string, unknown>) => void,
	isRow = false,
): void => {
	if (Array.isArray(value)) {
		for (const entry of value) {
			walkRows(entry, visit, true);
		}

		return;
	}

	if (!isPlainObject(value) || isRichTextState(value)) {
		return;
	}

	if (isRow || typeof value["blockType"] === "string") {
		visit(value);
	}

	for (const entry of Object.values(value)) {
		walkRows(entry, visit);
	}
};

/**
 * Keeps a row id only when the stored document has it and no earlier row in the
 * write claimed it. Other ids are dropped so Payload assigns a fresh one.
 *
 * A kept id makes Payload update the row in place, which preserves the other
 * locales of localized fields inside it. A duplicated id (a copied row) or a
 * foreign id would violate a SQL primary key.
 */
export const reconcileRowIds = (next: JsonObject, stored: JsonObject): void => {
	const known = new Set<unknown>();

	walkRows(stored, (row) => {
		if (row["id"] !== undefined) {
			known.add(row["id"]);
		}
	});

	const seen = new Set<unknown>();

	walkRows(next, (row) => {
		const id = row["id"];

		if (id === undefined) {
			return;
		}

		if (known.has(id) && !seen.has(id)) {
			seen.add(id);

			return;
		}

		delete row["id"];
	});
};

/** For create, where no stored row exists and any incoming id is invented. */
export const stripRowIds = (value: unknown): unknown => {
	const next = structuredClone(value);

	walkRows(next, (row) => {
		delete row["id"];
	});

	return next;
};
