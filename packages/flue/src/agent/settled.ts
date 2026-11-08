import { observe } from "@flue/runtime";

import { joinUrl } from "./exchange.js";
import { routePath } from "../protocol/paths.js";

import type { SettledRequest } from "../protocol/settled.js";
import type { FlueObservationSubscriber } from "@flue/runtime";

export interface SettlementReporterOptions {
	/** The Payload server URL. Defaults to the `PAYLOAD_URL` environment variable. */
	payloadUrl?: string;
	/** The shared sidecar secret. Defaults to the `FLUE_SIDECAR_SECRET` environment variable. */
	secret?: string;
	/** The plugin's endpoints below `payloadUrl`. Defaults to `/api/flue`. */
	fluePath?: string;
	fetch?: typeof fetch;
}

// The waits before the second and third attempt.
const RETRY_DELAYS_MS = [1000, 4000];
// How long one attempt may wait for Payload; a timeout counts as no answer.
const ATTEMPT_TIMEOUT_MS = 10_000;

const missing = (what: string): Error =>
	new Error(`[payloadcms-flue] reportSettlements needs ${what}.`);

/*
 * Whether an answer is worth another attempt: a 409 while the turn has not
 * recorded the submission yet, or a server error.
 */
const retriable = (status: number): boolean => status === 409 || status >= 500;

const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

/**
 * The `observe()` subscriber that tells Payload about every settled
 * submission, so threads nobody watches leave `running`. Each report is
 * tried up to three times on a network error, a 5xx or a 409, and a failure
 * is logged with its status only. Returns the delivery for tests; Flue never
 * awaits it.
 */
export const settlementReporter = ({
	payloadUrl = process.env["PAYLOAD_URL"],
	secret = process.env["FLUE_SIDECAR_SECRET"],
	fluePath = "/api/flue",
	fetch: fetchFn = fetch,
}: SettlementReporterOptions = {}): FlueObservationSubscriber => {
	if (!payloadUrl) {
		throw missing("payloadUrl or the PAYLOAD_URL environment variable");
	}

	if (!secret) {
		throw missing("secret or the FLUE_SIDECAR_SECRET environment variable");
	}

	const url = joinUrl(payloadUrl, `${fluePath}${routePath("settled")}`);

	const report = async (body: SettledRequest): Promise<void> => {
		let failure = "no answer";

		for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
			if (attempt > 0) {
				// eslint-disable-next-line no-await-in-loop
				await wait(RETRY_DELAYS_MS[attempt - 1] ?? 0);
			}

			let status: number;

			try {
				// eslint-disable-next-line no-await-in-loop
				const response = await fetchFn(url, {
					method: "POST",
					headers: {
						authorization: `Bearer ${secret}`,
						"content-type": "application/json",
					},
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
				});

				status = response.status;
			} catch {
				failure = "no answer";
				continue;
			}

			if (status < 300) {
				return;
			}

			failure = `status ${String(status)}`;

			if (!retriable(status)) {
				break;
			}
		}

		// eslint-disable-next-line no-console
		console.warn(
			`[payloadcms-flue] Could not report a settled submission to Payload (${failure}).`,
		);
	};

	return (observation, ctx) =>
		observation.type === "submission_settled"
			? report({ conversation: ctx.id, submissionId: observation.submissionId })
			: undefined;
};

const SLOT = Symbol.for("@abinnovision/payloadcms-flue/settlements");

type Slot = Partial<Record<typeof SLOT, () => void>>;

/**
 * Reports every settled submission of this process to Payload. Call it once
 * at module scope of the sidecar's `app.ts`; a later call, as after a dev
 * reload, replaces the earlier subscription. Returns the unsubscribe
 * function. `flue run` never loads `app.ts`, so CLI runs report nothing.
 */
export const reportSettlements = (
	options?: SettlementReporterOptions,
): (() => void) => {
	const subscriber = settlementReporter(options);
	const slot = globalThis as Slot;

	slot[SLOT]?.();
	slot[SLOT] = observe(subscriber);

	return slot[SLOT];
};
