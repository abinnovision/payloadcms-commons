/** The body the sidecar posts to the settled endpoint when a submission settles. */
export interface SettledRequest {
	/** The Flue conversation id, the route id Payload stores on the thread. */
	conversation: string;
	submissionId: string;
}
