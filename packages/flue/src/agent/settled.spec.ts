import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reportSettlements, settlementReporter } from "./settled.js";
import { fixtureJson } from "../../test/builders/fixtures.js";

import type { FlueEventContext, FlueObservation } from "@flue/runtime";

const observe = vi.hoisted(() => vi.fn());

vi.mock("@flue/runtime", () => ({ observe }));

const SECRET = "sidecar-secret-0123456789abcdefghijklmnop";
const PAYLOAD_URL = "https://cms.example.com/";
const SETTLED_URL = "https://cms.example.com/api/flue/settled";

/*
 * Recorded from a Flue 2.3.0 subscriber: completed, failed, aborted, and a
 * submission recovered after a restart. Each `errorInfo.stack` was replaced
 * with "[redacted]" after recording, since it held local filesystem paths.
 */
const RECORDED = fixtureJson<
	{
		observation: Extract<FlueObservation, { type: "submission_settled" }>;
		context: Pick<FlueEventContext, "id">;
	}[]
>("flue-observe-settled.json");

const contextOf = (id: string): FlueEventContext => ({
	id,
	agentName: "Editor",
	env: {},
	req: undefined,
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
});

interface Recorded {
	url: string;
	method: string | undefined;
	headers: Headers;
	body: unknown;
	signal: AbortSignal | null | undefined;
}

/** A fetch that records each request and answers with the next of `statuses`, the last repeating. */
const recordingFetch = (...statuses: (Error | number)[]) => {
	const requests: Recorded[] = [];

	const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		requests.push({
			url: input instanceof Request ? input.url : String(input),
			method: init?.method,
			headers: new Headers(init?.headers),
			signal: init?.signal,
			body:
				typeof init?.body === "string"
					? (JSON.parse(init.body) as unknown)
					: undefined,
		});

		const answer =
			statuses[Math.min(requests.length, statuses.length) - 1] ?? 204;

		return answer instanceof Error
			? Promise.reject(answer)
			: Promise.resolve(new Response(null, { status: answer }));
	};

	return { requests, fetch };
};

const settled = RECORDED[0]!;

describe("settlementReporter", () => {
	let warn: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	const reporter = (fetch: typeof globalThis.fetch) =>
		settlementReporter({ payloadUrl: PAYLOAD_URL, secret: SECRET, fetch });

	it("ignores every other event type", () => {
		const { requests, fetch } = recordingFetch(204);
		const running: FlueObservation = {
			type: "submission_running",
			submissionId: settled.observation.submissionId,
			kind: "direct",
			attemptCount: 1,
			maxAttempts: 3,
			instanceId: "conv-1",
			v: 3,
			eventIndex: 1,
			timestamp: settled.observation.timestamp,
		};

		expect(reporter(fetch)(running, contextOf("conv-1"))).toBeUndefined();
		expect(requests).toEqual([]);
	});

	it.each(RECORDED.map((entry) => [entry.observation.outcome, entry] as const))(
		"posts a %s settlement once with the bearer secret, the route id and the submission",
		async (_, { observation, context }) => {
			const { requests, fetch } = recordingFetch(204);

			await reporter(fetch)(observation, contextOf(context.id));

			expect(requests).toHaveLength(1);
			expect(requests[0]?.url).toBe(SETTLED_URL);
			expect(requests[0]?.method).toBe("POST");
			expect(requests[0]?.headers.get("authorization")).toBe(
				`Bearer ${SECRET}`,
			);
			expect(requests[0]?.headers.get("content-type")).toBe("application/json");
			expect(requests[0]?.body).toEqual({
				conversation: context.id,
				submissionId: observation.submissionId,
			});
			expect(warn).not.toHaveBeenCalled();
		},
	);

	it.each([503, 409])(
		"retries a %i after 1 s and 4 s and stops after three attempts",
		async (status) => {
			vi.useFakeTimers();

			const { requests, fetch } = recordingFetch(status);
			const delivery = reporter(fetch)(
				settled.observation,
				contextOf("conv-1"),
			);

			await vi.advanceTimersByTimeAsync(999);
			expect(requests).toHaveLength(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(requests).toHaveLength(2);
			await vi.advanceTimersByTimeAsync(3999);
			expect(requests).toHaveLength(2);
			await vi.advanceTimersByTimeAsync(1);
			expect(requests).toHaveLength(3);
			await delivery;
			await vi.runAllTimersAsync();

			expect(requests).toHaveLength(3);
			expect(warn).toHaveBeenCalledOnce();
			expect(String(warn.mock.calls[0]?.[0])).toContain(
				`status ${String(status)}`,
			);
			expect(String(warn.mock.calls[0]?.[0])).not.toContain(SECRET);
		},
	);

	it("retries a network error and stops once Payload accepts", async () => {
		vi.useFakeTimers();

		const { requests, fetch } = recordingFetch(
			new TypeError("fetch failed"),
			409,
			204,
		);
		const delivery = reporter(fetch)(settled.observation, contextOf("conv-1"));

		await vi.runAllTimersAsync();
		await delivery;

		expect(requests).toHaveLength(3);
		expect(warn).not.toHaveBeenCalled();
	});

	it.each(["AbortError", "TimeoutError"])(
		"gives each attempt a deadline and retries one that ends in an %s",
		async (name) => {
			vi.useFakeTimers();

			const aborted = new DOMException("The operation was aborted.", name);
			const { requests, fetch } = recordingFetch(aborted, aborted, aborted);
			const delivery = reporter(fetch)(
				settled.observation,
				contextOf("conv-1"),
			);

			await vi.runAllTimersAsync();
			await delivery;

			expect(requests).toHaveLength(3);
			expect(requests.map((request) => request.signal)).toEqual([
				expect.any(AbortSignal),
				expect.any(AbortSignal),
				expect.any(AbortSignal),
			]);
			expect(String(warn.mock.calls[0]?.[0])).toContain("no answer");
		},
	);

	it("does not retry a 401", async () => {
		vi.useFakeTimers();

		const { requests, fetch } = recordingFetch(401);
		const delivery = reporter(fetch)(settled.observation, contextOf("conv-1"));

		await vi.runAllTimersAsync();
		await delivery;

		expect(requests).toHaveLength(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain("status 401");
	});

	it("reads the environment unless options are given", async () => {
		vi.stubEnv("PAYLOAD_URL", "https://env.example.com");
		vi.stubEnv("FLUE_SIDECAR_SECRET", "env-secret-0123456789abcdefghijklmnop");

		const fromEnv = recordingFetch(204);
		const explicit = recordingFetch(204);

		await settlementReporter({ fetch: fromEnv.fetch })(
			settled.observation,
			contextOf("conv-1"),
		);
		await settlementReporter({
			payloadUrl: "https://cms.example.com/base/",
			secret: SECRET,
			fluePath: "/custom/flue",
			fetch: explicit.fetch,
		})(settled.observation, contextOf("conv-1"));

		expect(fromEnv.requests[0]?.url).toBe(
			"https://env.example.com/api/flue/settled",
		);
		expect(fromEnv.requests[0]?.headers.get("authorization")).toBe(
			"Bearer env-secret-0123456789abcdefghijklmnop",
		);
		expect(explicit.requests[0]?.url).toBe(
			"https://cms.example.com/base/custom/flue/settled",
		);
		expect(explicit.requests[0]?.headers.get("authorization")).toBe(
			`Bearer ${SECRET}`,
		);
	});

	it("throws without a Payload URL or a secret", () => {
		vi.stubEnv("PAYLOAD_URL", "");
		vi.stubEnv("FLUE_SIDECAR_SECRET", "");

		expect(() => settlementReporter({ secret: SECRET })).toThrow(/PAYLOAD_URL/);
		expect(() => settlementReporter({ payloadUrl: PAYLOAD_URL })).toThrow(
			/FLUE_SIDECAR_SECRET/,
		);
	});
});

describe("reportSettlements", () => {
	it("replaces the subscription of an earlier call", () => {
		const first = vi.fn();
		const second = vi.fn();

		observe.mockReturnValueOnce(first).mockReturnValueOnce(second);

		const options = { payloadUrl: PAYLOAD_URL, secret: SECRET };

		expect(reportSettlements(options)).toBe(first);
		expect(reportSettlements(options)).toBe(second);
		expect(observe).toHaveBeenCalledTimes(2);
		expect(first).toHaveBeenCalledOnce();
		expect(second).not.toHaveBeenCalled();

		second();
	});
});
