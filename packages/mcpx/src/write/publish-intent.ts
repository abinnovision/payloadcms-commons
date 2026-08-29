import { randomUUID } from "node:crypto";

/*
 * The marker `publishDocument` puts on the one write the draft guard may let
 * through as a publish.
 *
 * It rides on the write's own `data` rather than on the request, so it can only
 * authorise the write it is attached to; nothing needs scoping to a slug or an
 * id. Payload carries it that far because `updateByID` deep-copies `data` and
 * `beforeValidate` mutates that same object rather than rebuilding it. The
 * `beforeChange` alarm takes it off again, and the traversal that builds the
 * saved document reads only schema fields, so it never reaches the database.
 *
 * A string key, not a symbol: Payload's copy is `for (const k in value)`, which
 * drops symbols. The value is a token minted per process, so a client cannot
 * forge the marker by writing a field that shares the key.
 */
const PUBLISH_INTENT = "__mcpxPublishIntent";
const TOKEN = randomUUID();

export const withPublishIntent = <T extends object>(data: T): T => ({
	...data,
	[PUBLISH_INTENT]: TOKEN,
});

const carries = (data: unknown): data is Record<string, unknown> =>
	typeof data === "object" &&
	data !== null &&
	(data as Record<string, unknown>)[PUBLISH_INTENT] === TOKEN;

export const hasPublishIntent = (data: unknown): boolean => carries(data);

/** Asked by the last hook that needs it, so it takes the marker off. */
export const takePublishIntent = (data: unknown): boolean => {
	if (!carries(data)) {
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
