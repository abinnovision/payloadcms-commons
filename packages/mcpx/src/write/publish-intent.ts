import { randomUUID } from "node:crypto";

/*
 * The marker `publishDocument` puts on the one write the draft guard is allowed
 * to let through as a publish.
 *
 * It travels on the write's own `data` object rather than on the request or in
 * ambient state, which is what makes it exact: `data` belongs to one operation,
 * so the marker can only ever authorise the write it is attached to. A
 * concurrent tool call in the same JSON-RPC batch has its own `data` and is
 * unaffected, and a nested write from a hook during the publish has one too, so
 * it meets the unmodified guard. Nothing has to be scoped to a slug or an id,
 * because nothing else can reach it.
 *
 * Payload carries it as far as it needs to go: `updateByID` deep-copies `data`
 * before the operation, and `beforeValidate` mutates and returns that same
 * object rather than rebuilding it, so the marker reaches the `beforeChange`
 * alarm. The alarm takes it off again, and the field traversal that builds the
 * saved document reads only schema fields, so it cannot reach the database
 * either way.
 *
 * A string key, not a symbol: Payload's copy is `for (const k in value)`, which
 * drops symbols. The value is a token minted per process instead, so a client
 * cannot forge the marker by writing a field that happens to share the key.
 */
const PUBLISH_INTENT = "__mcpxPublishIntent";
const TOKEN = randomUUID();

/** Marks `data` as the publish that was asked for. */
export const withPublishIntent = <T extends object>(data: T): T => ({
	...data,
	[PUBLISH_INTENT]: TOKEN,
});

const carries = (data: unknown): data is Record<string, unknown> =>
	typeof data === "object" &&
	data !== null &&
	(data as Record<string, unknown>)[PUBLISH_INTENT] === TOKEN;

/** Whether this write is that publish. Leaves the marker in place. */
export const hasPublishIntent = (data: unknown): boolean => carries(data);

/**
 * The same question, asked by the last hook that needs the answer, which takes
 * the marker off so nothing downstream sees it.
 */
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
