import { describe, expect, it } from "vitest";

import { canInlineCreate } from "./permissions.js";

describe("canInlineCreate", () => {
	it("allows inline create when the user may create tags", () => {
		const permissions = {
			collections: { tags: { create: { permission: true } } },
		};

		expect(canInlineCreate(permissions, "tags")).toBe(true);
	});

	it("accepts the sanitized shape the admin's useAuth() returns", () => {
		const permissions = { collections: { tags: { create: true as const } } };

		expect(canInlineCreate(permissions, "tags")).toBe(true);
	});

	it("is blocked when the user has no create permission on the tags collection", () => {
		const permissions = {
			collections: { tags: { create: { permission: false } } },
		};

		expect(canInlineCreate(permissions, "tags")).toBe(false);
	});

	it("is blocked when permissions are missing entirely", () => {
		expect(canInlineCreate(undefined, "tags")).toBe(false);
	});

	it("is blocked when the tags collection is absent from permissions", () => {
		expect(canInlineCreate({ collections: {} }, "tags")).toBe(false);
	});
});
