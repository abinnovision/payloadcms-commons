/**
 * Lifecycle of a message, as reported by the send endpoint and by webhooks. A
 * fresh send answers `pending`; everything past `queued` is only ever observed
 * later, through the Lettermint dashboard or a delivery webhook.
 */
type LettermintMessageStatus =
	| "blocked"
	| "clicked"
	| "delivered"
	| "failed"
	| "hard_bounced"
	| "opened"
	| "pending"
	| "policy_rejected"
	| "processed"
	| "queued"
	| "soft_bounced"
	| "spam_complaint"
	| "suppressed"
	| "unsubscribed";

/** What `POST /v1/send` answers on success. */
interface LettermintSendResponse {
	message_id: string;
	status: LettermintMessageStatus;
}

/** Per-message overrides of the settings a route otherwise decides. */
interface LettermintSettings {
	track_clicks?: boolean;
	track_opens?: boolean;
	tls?: "enforced" | "opportunistic";
}

/**
 * A tag on the message. Lettermint accepts at most 20, with `name` matching
 * `^[A-Za-z0-9_-]{1,32}$` and `value` matching `^[A-Za-z0-9_-]{1,64}$`.
 */
interface LettermintTag {
	name: string;
	value: string;
}

interface LettermintAdapterArgs {
	/** Project API token (`lm_…`), sent as the `x-lettermint-token` header. */
	apiToken: string;
	/** Address every message is sent from unless it carries its own `from`. */
	defaultFromAddress: string;
	/** Display name paired with {@link LettermintAdapterArgs.defaultFromAddress}. */
	defaultFromName: string;
	/**
	 * Route slug to send on. Omitted means the project's default route. Payload
	 * sends transactional mail, so this should name a transactional route:
	 * broadcast routes add hosted unsubscribe handling.
	 */
	route?: string;
	/** Applied to every message, overriding what the route decides. */
	settings?: LettermintSettings;
	/** Metadata attached to every message. Tracked, never sent as headers. */
	metadata?: Record<string, string>;
	/** Tags attached to every message. */
	tags?: LettermintTag[];
	/**
	 * Redirect every message to this address, dropping `cc` and `bcc`. Meant for
	 * staging environments working on a copy of production data.
	 */
	overrideRecipientAddress?: string;
	/** Defaults to `https://api.lettermint.co/v1`. */
	baseUrl?: string;
	/** Request timeout in milliseconds. Defaults to 30000. */
	timeout?: number;
}

export type {
	LettermintAdapterArgs,
	LettermintMessageStatus,
	LettermintSendResponse,
	LettermintSettings,
	LettermintTag,
};
