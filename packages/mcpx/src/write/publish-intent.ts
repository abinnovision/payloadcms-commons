import { randomUUID } from "node:crypto";

import { isPlainObject } from "../guards.js";

/*
 * Marks the one write `publishDocument` lets the draft guard pass as a publish.
 * It rides on that write's `data`, which `updateByID` deep-copies and
 * `beforeValidate` mutates in place. The `beforeChange` guard removes it and
 * the save reads only schema fields, so it never reaches the database. The key
 * is a string because Payload copies with `for (const k in value)`, which drops
 * symbols. The value is a per-process token, so a client cannot forge it.
 */
const PUBLISH_INTENT = "__mcpxPublishIntent";
// The same, for the trash move `deleteDocument` makes.
const TRASH_INTENT = "__mcpxTrashIntent";
// The same, for the duplicate `duplicateDocument` makes.
const DUPLICATE_INTENT = "__mcpxDuplicateIntent";
const TOKEN = randomUUID();

const take = (data: unknown, key: string): boolean => {
	if (!isPlainObject(data) || data[key] !== TOKEN) {
		return false;
	}

	/*
	 * The key is a module constant, not caller input; the rule guards against
	 * deleting an attacker-chosen key.
	 */
	// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
	delete data[key];

	return true;
};

export const withPublishIntent = <T extends object>(data: T): T => ({
	...data,
	[PUBLISH_INTENT]: TOKEN,
});

export const hasPublishIntent = (
	data: unknown,
): data is Record<string, unknown> =>
	isPlainObject(data) && data[PUBLISH_INTENT] === TOKEN;

/**
 * Called by the last hook that needs the marker, which removes it.
 */
export const takePublishIntent = (data: unknown): boolean =>
	take(data, PUBLISH_INTENT);

export const withTrashIntent = <T extends object>(data: T): T => ({
	...data,
	[TRASH_INTENT]: TOKEN,
});

export const hasTrashIntent = (
	data: unknown,
): data is Record<string, unknown> =>
	isPlainObject(data) && data[TRASH_INTENT] === TOKEN;

/**
 * The counterpart of {@link takePublishIntent}.
 */
export const takeTrashIntent = (data: unknown): boolean =>
	take(data, TRASH_INTENT);

export const withDuplicateIntent = <T extends object>(data: T): T => ({
	...data,
	[DUPLICATE_INTENT]: TOKEN,
});

/**
 * Removes the marker, so it never reaches the operation.
 */
export const takeDuplicateIntent = (data: unknown): boolean =>
	take(data, DUPLICATE_INTENT);
