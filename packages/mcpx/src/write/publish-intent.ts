import { randomUUID } from "node:crypto";

/*
 * Marks the one write `publishDocument` lets the draft guard pass as a publish.
 * It rides on the write's own `data`, so it can authorise only that write.
 * Payload carries it because `updateByID` deep-copies `data` and
 * `beforeValidate` mutates the copy in place. The `beforeChange` guard removes
 * it, and the save reads only schema fields, so it never reaches the database.
 *
 * The key is a string because Payload copies with `for (const k in value)`,
 * which drops symbols. The value is a per-process token, so a client cannot
 * forge the marker by writing a field with the same name.
 */
const PUBLISH_INTENT = "__mcpxPublishIntent";
const TOKEN = randomUUID();

export const withPublishIntent = <T extends object>(data: T): T => ({
	...data,
	[PUBLISH_INTENT]: TOKEN,
});

export const hasPublishIntent = (
	data: unknown,
): data is Record<string, unknown> =>
	typeof data === "object" &&
	data !== null &&
	(data as Record<string, unknown>)[PUBLISH_INTENT] === TOKEN;

/** Called by the last hook that needs the marker, which removes it. */
export const takePublishIntent = (data: unknown): boolean => {
	if (!hasPublishIntent(data)) {
		return false;
	}

	/*
	 * The key is a module constant, not caller input; the rule guards against
	 * deleting an attacker-chosen key.
	 */
	// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
	delete data[PUBLISH_INTENT];

	return true;
};
