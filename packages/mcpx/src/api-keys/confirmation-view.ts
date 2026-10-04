import type { McpxConfirmationSummary } from "../types.js";

/**
 * Path of the confirmations endpoints below the plugin's endpoint path.
 */
export const CONFIRMATIONS_PATH = "/confirmations";

/**
 * One pending call as the API key's edit view lists it. Plain data, shared by
 * the endpoint and the admin component.
 */
export interface ConfirmationView {
	/**
	 * What a decision names the call by. Not the id the client holds.
	 */
	handle: string;
	tool: string;
	/**
	 * Heading of the call's group.
	 */
	group: string;
	/**
	 * The call the page was opened for, through its `?confirmation=` link.
	 */
	highlighted: boolean;
	summary: McpxConfirmationSummary;
}

export type ConfirmationDecision = "approved" | "rejected";
