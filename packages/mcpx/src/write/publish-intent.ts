import { randomUUID } from "node:crypto";

import { isPlainObject } from "../guards.js";

/*
 * Marks the one write `publishDocument` lets the draft guard pass as a publish.
 * It rides on that write's `data`, which `updateByID` deep-copies and
 * `beforeValidate` mutates in place. The `beforeChange` guard removes it and
 * the save reads only schema fields, so it never reaches the database. The key
 * is a string because Payload copies with `for (const k in value)`, which drops
 * symbols. The value is a per-process token, so a client cannot forge it. The
 * trash move `deleteDocument` makes and the duplicate `duplicateDocument` makes
 * are marked the same way.
 */
const TOKEN = randomUUID();

const intent = (key: string) => ({
	has: (data: unknown): data is Record<string, unknown> =>
		isPlainObject(data) && data[key] === TOKEN,
	// Removes the marker, so it never reaches the operation.
	take: (data: unknown): boolean => {
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
	},
	with: <T extends object>(data: T): T => ({ ...data, [key]: TOKEN }),
});

const publish = intent("__mcpxPublishIntent");
const trash = intent("__mcpxTrashIntent");
const duplicate = intent("__mcpxDuplicateIntent");

export const withPublishIntent = publish.with;
export const hasPublishIntent = publish.has;

/**
 * Called by the last hook that needs the marker, which removes it.
 */
export const takePublishIntent = publish.take;

export const withTrashIntent = trash.with;
export const hasTrashIntent = trash.has;
export const takeTrashIntent = trash.take;

export const withDuplicateIntent = duplicate.with;
export const takeDuplicateIntent = duplicate.take;
