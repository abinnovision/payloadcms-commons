import { describe, expect, it } from "vitest";

import { isOwner } from "./owner.js";

const user = { id: 7, collection: "users" };

describe("isOwner", () => {
	it("accepts the user named by id", () => {
		expect(isOwner({ relationTo: "users", value: 7 }, user, "users")).toBe(
			true,
		);
	});

	it("accepts the user named by a populated document", () => {
		expect(
			isOwner({ relationTo: "users", value: { id: 7 } }, user, "users"),
		).toBe(true);
	});

	it("matches a numeric id against its string form", () => {
		expect(
			isOwner(
				{ relationTo: "users", value: "7" },
				{ id: 7, collection: "users" },
				"users",
			),
		).toBe(true);
	});

	it("refuses a row created by another collection's user with the same id", () => {
		expect(isOwner({ relationTo: "admins", value: 7 }, user, "users")).toBe(
			false,
		);
	});

	it("refuses a user outside the user collection", () => {
		expect(
			isOwner(
				{ relationTo: "admins", value: 7 },
				{ id: 7, collection: "admins" },
				"users",
			),
		).toBe(false);
	});

	it("refuses another user and a row without createdBy", () => {
		expect(isOwner({ relationTo: "users", value: 8 }, user, "users")).toBe(
			false,
		);
		expect(isOwner(null, user, "users")).toBe(false);
		expect(isOwner({ relationTo: "users", value: 7 }, null, "users")).toBe(
			false,
		);
	});
});
