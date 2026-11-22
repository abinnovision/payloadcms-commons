import type { RunKind } from "./context.js";

/** The key of the conversation's Flue `initialData` that holds {@link FlueInitialData}. */
export const INITIAL_DATA_KEY = "@abinnovision/payloadcms-flue";

/**
 * Set once, when Payload creates the conversation. The handle is a random
 * value the sidecar trades for the thread's token; Payload stores only its hash.
 */
export interface FlueInitialData {
	handle: string;
}

/** The body the sidecar posts to the exchange endpoint. */
export interface ExchangeRequest {
	handle: string;
	/** The slug the agent is mounted under in the sidecar. */
	agent: string;
}

/** What the exchange endpoint returns for a live handle. */
export interface ExchangeResponse {
	/**
	 * The thread's `flue_` token, a bearer for mcpx and Payload's REST API.
	 * Held in memory for the run and never logged.
	 */
	key: string;
	/** The mcpx endpoint path below the Payload server URL, such as `/api/mcpx`. */
	mcpPath: string;
	/** ISO timestamp after which the token stops authenticating, at the latest. */
	expiresAt: string;
	/** The user the agent acts as. */
	user: { collection: string; id: number | string };
	/** The id of the thread row. */
	thread: number | string;
	kind: RunKind;
}
