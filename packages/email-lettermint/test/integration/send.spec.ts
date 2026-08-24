import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { bootPayload } from "./helpers/payload.js";
import { LettermintEmailError } from "../../src/index.js";

import type { Payload } from "payload";

interface Captured {
	url: string;
	init: RequestInit;
}

const captured: Captured[] = [];

/**
 * Stubs the endpoint and records what the adapter sent. Nothing here reaches
 * the network.
 */
const stubLettermint = (status: number, body: unknown): void => {
	vi.stubGlobal(
		"fetch",
		vi.fn((url: string, init: RequestInit) => {
			captured.push({ url, init });

			return Promise.resolve(
				new Response(JSON.stringify(body), {
					status,
					headers: { "content-type": "application/json" },
				}),
			);
		}),
	);
};

const lastBody = (): Record<string, unknown> =>
	JSON.parse(captured.at(-1)?.init.body as string) as Record<string, unknown>;

const accepted = { message_id: "msg_integration", status: "pending" };

describe("lettermint adapter inside Payload", () => {
	let payload: Payload;

	beforeAll(async () => {
		payload = await bootPayload("lettermint-send");
	});

	afterEach(() => {
		captured.length = 0;
		vi.unstubAllGlobals();
	});

	it("registers itself as Payload's email adapter", () => {
		expect(payload.email.name).toBe("lettermint");
		expect(payload.email.defaultFromAddress).toBe("no-reply@example.com");
	});

	it("sends what payload.sendEmail is given", async () => {
		stubLettermint(202, accepted);

		await expect(
			payload.sendEmail({
				to: "user@example.com",
				subject: "Hello",
				html: "<p>Hi</p>",
			}),
		).resolves.toStrictEqual(accepted);

		expect(captured).toHaveLength(1);
		expect(captured[0]?.url).toBe("https://api.lettermint.co/v1/send");
		expect(captured[0]?.init.headers).toMatchObject({
			"x-lettermint-token": "lm_integration",
		});
		expect(lastBody()).toStrictEqual({
			from: "Example CMS <no-reply@example.com>",
			to: ["user@example.com"],
			subject: "Hello",
			html: "<p>Hi</p>",
			route: "outgoing",
		});
	});

	it("carries a real forgot-password mail through the adapter", async () => {
		await payload.create({
			collection: "users",
			data: { email: "reset@example.com", password: "test-password-1" },
		});

		stubLettermint(202, accepted);

		await payload.forgotPassword({
			collection: "users",
			data: { email: "reset@example.com" },
			disableEmail: false,
		});

		const body = lastBody();

		expect(body["to"]).toStrictEqual(["reset@example.com"]);
		expect(body["from"]).toBe('"Example CMS" <no-reply@example.com>');
		expect(typeof body["html"]).toBe("string");
	});

	it("surfaces a rejected send with the field detail intact", async () => {
		stubLettermint(422, {
			message: "The given data was invalid.",
			errors: { from: ["The from domain is not verified."] },
		});

		const error = await payload
			.sendEmail({ to: "user@example.com", subject: "Hello", html: "<p>x</p>" })
			.catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(LettermintEmailError);
		expect((error as LettermintEmailError).message).toBe(
			"Lettermint rejected the message: from: The from domain is not verified.",
		);
		expect((error as LettermintEmailError).statusCode).toBe(422);
	});
});
