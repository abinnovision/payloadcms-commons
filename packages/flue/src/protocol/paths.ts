/**
 * The plugin's endpoints as Payload registers them, relative to the
 * plugin's `endpointPath`.
 */
export const FLUE_ROUTES = {
	agents: "/agents",
	chat: "/chat/:agent",
	/** A thread's Flue conversation route: `view=history` and `view=updates`. */
	conversation: "/c/:thread",
	conversationAbort: "/c/:thread/abort",
	exchange: "/exchange",
	/** The sidecar reports a settled submission; Payload reconciles from history. */
	settled: "/settled",
} as const;

/** A key of {@link FLUE_ROUTES}. */
export type FlueRoute = keyof typeof FLUE_ROUTES;

/**
 * The path of a route relative to `endpointPath`, each `:param` segment
 * replaced by its URI-encoded value. Throws for a missing parameter.
 */
export const routePath = (
	route: FlueRoute,
	params: Readonly<Record<string, number | string>> = {},
): string =>
	FLUE_ROUTES[route].replace(/:(\w+)/g, (_, name: string) => {
		const value = params[name];

		if (value === undefined) {
			throw new Error(`Route "${route}" needs the parameter "${name}".`);
		}

		return encodeURIComponent(String(value));
	});
