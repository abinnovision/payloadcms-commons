import type { RequestContext } from "payload";

/**
 * The `context` every seed write passes to the Local API.
 *
 * A fresh object per call: Payload hands it to hooks as is, and a hook that
 * sets a flag on it must not leak that flag into the next write.
 */
export const dummyContext = (): RequestContext => ({ dummy: true });

/**
 * Whether a hook runs for a seed write, so it can skip side effects such as
 * revalidation or emails. Takes `req` or a hook's own args.
 *
 * @param args Anything carrying the operation's `context`.
 */
export const isDummyWrite = (
	args: { context?: RequestContext } | null | undefined,
): boolean => args?.context?.["dummy"] === true;
