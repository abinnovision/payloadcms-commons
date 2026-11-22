import { describe, expect, it } from "vitest";

import { confirmationOf, reviewPath } from "./confirmation.js";

const ORIGIN = "https://cms.example.com";
const EXP = "2026-11-21T12:00:00.000Z";
const URL_IN_ADMIN = `${ORIGIN}/admin/collections/mcpx-api-keys/3?confirmation=c-1`;

describe("reviewPath", () => {
	it("keeps the path and query of a URL into the admin's collections", () => {
		expect(reviewPath(URL_IN_ADMIN, ORIGIN, "/admin")).toBe(
			"/admin/collections/mcpx-api-keys/3?confirmation=c-1",
		);
	});

	it("rejects a URL outside the admin's collections", () => {
		expect(
			reviewPath("https://evil.example/phish", ORIGIN, "/admin"),
		).toBeUndefined();
		expect(
			reviewPath(`${ORIGIN}/admin/account`, ORIGIN, "/admin"),
		).toBeUndefined();
		expect(reviewPath("not a url", "", "/admin")).toBeUndefined();
	});
});

describe("confirmationOf", () => {
	it("reads the confirmation of a key's call with its review path", () => {
		expect(
			confirmationOf(
				{
					confirmation: {
						id: "c-1",
						principal: "3",
						expiresAt: EXP,
						url: URL_IN_ADMIN,
					},
				},
				ORIGIN,
				"/admin",
			),
		).toEqual({
			id: "c-1",
			principal: "3",
			review: "/admin/collections/mcpx-api-keys/3?confirmation=c-1",
		});
	});

	it("reads a thread's confirmation, which has no URL", () => {
		const result = {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						confirmation: {
							id: "c-1",
							principal: "flue-thread:7",
							expiresAt: EXP,
						},
					}),
				},
			],
		};

		expect(confirmationOf(result, ORIGIN, "/admin")).toEqual({
			id: "c-1",
			principal: "flue-thread:7",
			review: undefined,
		});
	});

	it("drops a URL that leads outside the admin", () => {
		expect(
			confirmationOf(
				JSON.stringify({
					confirmation: {
						id: "c-1",
						principal: "flue-thread:7",
						expiresAt: EXP,
						url: "https://evil.example/phish",
					},
				}),
				ORIGIN,
				"/admin",
			),
		).toEqual({ id: "c-1", principal: "flue-thread:7", review: undefined });
	});

	it("finds none without an id, a principal or an expiry", () => {
		expect(
			confirmationOf(
				{ confirmation: { url: URL_IN_ADMIN, principal: "3" } },
				ORIGIN,
				"/admin",
			),
		).toBeUndefined();
		expect(
			confirmationOf({ confirmation: { id: "c-1" } }, ORIGIN, "/admin"),
		).toBeUndefined();
		expect(
			confirmationOf(
				{ confirmation: { id: "c-1", principal: "flue-thread:7" } },
				ORIGIN,
				"/admin",
			),
		).toBeUndefined();
	});

	it("finds none in an ordinary result", () => {
		expect(confirmationOf({ docs: [] }, ORIGIN, "/admin")).toBeUndefined();
		expect(confirmationOf(undefined, ORIGIN, "/admin")).toBeUndefined();
	});
});
