import { LettermintClient } from "lettermint";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lettermintAdapter } from "./adapter.js";

import type { LettermintAdapterArgs } from "./types.js";
import type { Payload } from "payload";

const identity: Omit<LettermintAdapterArgs, "apiToken" | "client"> = {
	defaultFromAddress: "no-reply@example.com",
	defaultFromName: "Example CMS",
};

const args: LettermintAdapterArgs = {
	...identity,
	apiToken: "lm_test",
};

const accepted = (): typeof fetch =>
	vi.fn(() =>
		Promise.resolve(
			new Response(JSON.stringify({ message_id: "msg_1", status: "pending" }), {
				status: 202,
				headers: { "content-type": "application/json" },
			}),
		),
	);

const fakePayload = () =>
	({ logger: { warn: vi.fn() } }) as unknown as Payload & {
		logger: { warn: ReturnType<typeof vi.fn> };
	};

const sentBody = (fetchMock: typeof fetch): Record<string, unknown> =>
	JSON.parse(
		(vi.mocked(fetchMock).mock.calls[0]?.[1] as RequestInit).body as string,
	) as Record<string, unknown>;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("lettermintAdapter", () => {
	it("refuses a blank token at config time", () => {
		expect(() => lettermintAdapter({ ...args, apiToken: " " })).toThrow(
			/apiToken is required/,
		);
	});

	it("refuses config with neither apiToken nor client", () => {
		expect(() => lettermintAdapter(identity)).toThrow(/apiToken is required/);
	});

	it("refuses a client that isn't a LettermintClient instance", () => {
		const fakeClient = { authMode: "sending" } as unknown as LettermintClient;

		expect(() =>
			lettermintAdapter({ ...identity, client: fakeClient }),
		).toThrow(/must be an instance of.*LettermintClient/);
	});

	it("refuses a missing from address at config time", () => {
		expect(() =>
			lettermintAdapter({ ...args, defaultFromAddress: "" }),
		).toThrow(/defaultFromAddress is required/);
	});

	it("refuses a non-positive timeout", () => {
		expect(() => lettermintAdapter({ ...args, timeout: 0 })).toThrow(
			/timeout must be a positive number/,
		);
	});

	it("exposes the identity Payload's auth emails rely on", () => {
		const adapter = lettermintAdapter(args)({ payload: fakePayload() });

		expect(adapter.name).toBe("lettermint");
		expect(adapter.defaultFromAddress).toBe("no-reply@example.com");
		expect(adapter.defaultFromName).toBe("Example CMS");
	});

	it("defaults from to the configured identity", async () => {
		const fetchMock = accepted();

		vi.stubGlobal("fetch", fetchMock);

		const adapter = lettermintAdapter(args)({ payload: fakePayload() });

		await adapter.sendEmail({ to: "a@b.io", subject: "s", html: "<p>x</p>" });

		expect(sentBody(fetchMock)["from"]).toBe(
			"Example CMS <no-reply@example.com>",
		);
	});

	it("lets a caller-supplied from win", async () => {
		const fetchMock = accepted();

		vi.stubGlobal("fetch", fetchMock);

		const adapter = lettermintAdapter(args)({ payload: fakePayload() });

		await adapter.sendEmail({
			from: "other@example.com",
			to: "a@b.io",
			subject: "s",
		});

		expect(sentBody(fetchMock)["from"]).toBe("other@example.com");
	});

	it("trims a trailing slash off a custom base url", async () => {
		const fetchMock = accepted();

		vi.stubGlobal("fetch", fetchMock);

		const adapter = lettermintAdapter({
			...args,
			baseUrl: "https://example.test/v1/",
		})({ payload: fakePayload() });

		await adapter.sendEmail({ to: "a@b.io", subject: "s" });

		expect(vi.mocked(fetchMock).mock.calls[0]?.[0]).toBe(
			"https://example.test/v1/send",
		);
	});

	it("reuses a caller-supplied client instead of building one", async () => {
		const fetchMock = accepted();

		vi.stubGlobal("fetch", fetchMock);

		const client = new LettermintClient({ apiToken: "lm_shared" });
		const adapter = lettermintAdapter({ ...identity, client })({
			payload: fakePayload(),
		});

		await adapter.sendEmail({ to: "a@b.io", subject: "s" });

		const [, init] = vi.mocked(fetchMock).mock.calls[0] as [
			string,
			RequestInit,
		];

		expect(init.headers).toMatchObject({ "x-lettermint-token": "lm_shared" });
	});

	it("warns about fields the API cannot express", async () => {
		vi.stubGlobal("fetch", accepted());

		const payload = fakePayload();
		const adapter = lettermintAdapter(args)({ payload });

		await adapter.sendEmail({ to: "a@b.io", subject: "s", priority: "high" });

		expect(payload.logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("priority"),
		);
	});
});
