import { describe, expect, it } from "vitest";

import { confirmationOf, reviewPath } from "./confirmation.js";

const ORIGIN = "https://cms.example.com";
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
	it("reads the confirmation of a parsed mcpx result", () => {
		expect(
			confirmationOf(
				{ confirmation: { id: "c-1", url: URL_IN_ADMIN } },
				ORIGIN,
				"/admin",
			),
		).toEqual({
			id: "c-1",
			key: "3",
			review: "/admin/collections/mcpx-api-keys/3?confirmation=c-1",
		});
	});

	it("reads the confirmation from the text of an MCP result", () => {
		const result = {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						confirmation: { id: "c-1", url: URL_IN_ADMIN },
					}),
				},
			],
		};

		expect(confirmationOf(result, ORIGIN, "/admin")).toMatchObject({
			id: "c-1",
			key: "3",
		});
	});

	it("takes the id from the URL when the result carries none", () => {
		expect(
			confirmationOf(
				JSON.stringify({ confirmation: { url: URL_IN_ADMIN } }),
				ORIGIN,
				"/admin",
			),
		).toMatchObject({ id: "c-1", key: "3" });
	});

	it("finds none in an ordinary result", () => {
		expect(confirmationOf({ docs: [] }, ORIGIN, "/admin")).toBeUndefined();
		expect(confirmationOf(undefined, ORIGIN, "/admin")).toBeUndefined();
	});

	it("finds none when the key in the URL is not a valid escape", () => {
		expect(
			confirmationOf(
				{
					confirmation: {
						id: "c-1",
						url: `${ORIGIN}/admin/collections/mcpx-api-keys/%E0%A4%A`,
					},
				},
				ORIGIN,
				"/admin",
			),
		).toBeUndefined();
	});

	it("finds none when the URL leads outside the admin", () => {
		expect(
			confirmationOf(
				{ confirmation: { id: "c-1", url: "https://evil.example/phish" } },
				ORIGIN,
				"/admin",
			),
		).toBeUndefined();
	});
});
