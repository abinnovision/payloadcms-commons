import type { LettermintClient } from "lettermint";

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
	/**
	 * Project API token (`lm_…`), sent as the `x-lettermint-token` header.
	 * Required unless {@link LettermintAdapterArgs.client} is given.
	 */
	apiToken?: string;
	/**
	 * An already-constructed `LettermintClient` to reuse instead of building one
	 * from {@link LettermintAdapterArgs.apiToken}. Useful when the app already
	 * holds a client for other Lettermint calls. Checked with `instanceof`, so
	 * an `ApiClient` or another duck-typed object is rejected at startup.
	 *
	 * Must use the default `authMode: "sending"` — a client built for
	 * `ApiClient`-style calls (`authMode: "api"`) sends a different auth header.
	 * `authMode` is a private field on the SDK's client, so this specific
	 * mismatch cannot be checked here; it surfaces as Lettermint rejecting the
	 * send at request time rather than as a startup error.
	 */
	client?: LettermintClient;
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
	/**
	 * Defaults to `https://api.lettermint.co/v1`. Ignored when
	 * {@link LettermintAdapterArgs.client} is given.
	 */
	baseUrl?: string;
	/**
	 * Request timeout in milliseconds. Defaults to 30000. Ignored when
	 * {@link LettermintAdapterArgs.client} is given.
	 */
	timeout?: number;
}

export type {
	LettermintAdapterArgs,
	LettermintMessageStatus,
	LettermintSendResponse,
	LettermintSettings,
	LettermintTag,
};
