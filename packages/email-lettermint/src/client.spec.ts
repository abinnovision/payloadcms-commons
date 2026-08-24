import { afterEach, describe, expect, it, vi } from "vitest";

import { sendMessage } from "./client.js";
import { LettermintEmailError } from "./errors.js";

import type { ClientOptions } from "./client.js";
import type { LettermintSendRequest } from "./message.js";

const options: ClientOptions = {
	apiToken: "lm_test",
	baseUrl: "https://api.lettermint.co/v1",
	timeout: 5_000,
};

const body: LettermintSendRequest = {
	from: "a@b.io",
	to: ["c@d.io"],
	subject: "s",
};

const respond = (status: number, payload: unknown): typeof fetch =>
	vi.fn(() =>
		Promise.resolve(
			new Response(
				typeof payload === "string" ? payload : JSON.stringify(payload),
				{
					status,
					headers: { "content-type": "application/json" },
				},
			),
		),
	);

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("sendMessage", () => {
	it("posts the message and returns the accepted response", async () => {
		const fetchMock = respond(202, { message_id: "msg_1", status: "pending" });

		vi.stubGlobal("fetch", fetchMock);

		await expect(sendMessage(body, options)).resolves.toStrictEqual({
			message_id: "msg_1",
			status: "pending",
		});

		const [url, init] = vi.mocked(fetchMock).mock.calls[0] as [
			string,
			RequestInit,
		];

		expect(url).toBe("https://api.lettermint.co/v1/send");
		expect(init.method).toBe("POST");
		expect(init.headers).toMatchObject({ "x-lettermint-token": "lm_test" });
		expect(JSON.parse(init.body as string)).toStrictEqual(body);
	});

	it("keeps the per-field detail of a 422", async () => {
		vi.stubGlobal(
			"fetch",
			respond(422, {
				message: "The given data was invalid.",
				errors: { to: ["The to field is required."] },
			}),
		);

		const error = await sendMessage(body, options).catch(
			(cause: unknown) => cause,
		);

		expect(error).toBeInstanceOf(LettermintEmailError);
		expect((error as LettermintEmailError).message).toBe(
			"Lettermint rejected the message: to: The to field is required.",
		);
		expect((error as LettermintEmailError).errors).toStrictEqual({
			to: ["The to field is required."],
		});
		expect((error as LettermintEmailError).statusCode).toBe(422);
	});

	it("reports an undocumented status defensively", async () => {
		vi.stubGlobal("fetch", respond(503, { message: "upstream unavailable" }));

		await expect(sendMessage(body, options)).rejects.toThrow(
			"Lettermint responded with 503: upstream unavailable",
		);
	});

	it("wraps a transport failure, keeping the cause", async () => {
		const cause = new Error("socket hang up");

		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.reject(cause)),
		);

		const error = await sendMessage(body, options).catch(
			(thrown: unknown) => thrown,
		);

		expect(error).toBeInstanceOf(LettermintEmailError);
		expect((error as LettermintEmailError).message).toBe(
			"Could not reach Lettermint.",
		);
		expect((error as LettermintEmailError).cause).toBe(cause);
	});

	it("reports a timeout with the configured budget", async () => {
		const cause = Object.assign(new Error("aborted"), { name: "TimeoutError" });

		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.reject(cause)),
		);

		await expect(sendMessage(body, options)).rejects.toThrow(
			"Lettermint did not answer within 5000ms.",
		);
	});
});
