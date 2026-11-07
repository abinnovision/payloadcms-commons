import { describe, expect, it } from "vitest";

import {
	hasRole,
	readClaim,
	resolveRoles,
	roleOptions,
	toStrings,
} from "./roles.js";

import type { OidcSignInContext } from "./context.js";
import type { AuthenticatedUser } from "payload";

const context = (
	parts: Partial<Omit<OidcSignInContext, "req">> = {},
): OidcSignInContext => {
	const value = {
		claims: { sub: "s" },
		userinfo: undefined,
		accessToken: undefined,
		req: {},
		...parts,
	};

	return value as unknown as OidcSignInContext;
};

describe("readClaim", () => {
	it("prefers the ID token over userinfo and the access token", () => {
		const ctx = context({
			claims: { sub: "s", groups: ["id"] },
			userinfo: { groups: ["userinfo"] },
			accessToken: { groups: ["access"] },
		});

		expect(readClaim(ctx, "groups")).toEqual(["id"]);
	});

	it("falls through to the access token", () => {
		const ctx = context({ accessToken: { realm_access: { roles: ["a"] } } });

		expect(readClaim(ctx, ["realm_access", "roles"])).toEqual(["a"]);
	});

	it("treats a name with dots or colons as one segment", () => {
		const ctx = context({ userinfo: { "urn:x:roles": { a: {} } } });

		expect(readClaim(ctx, "urn:x:roles")).toEqual({ a: {} });
	});

	it("does not read inherited properties", () => {
		expect(readClaim(context(), "constructor")).toBeUndefined();
	});
});

describe("toStrings", () => {
	it.each([
		["a", ["a"]],
		[
			["a", 1, "b"],
			["a", "b"],
		],
		[{ a: 1, b: 2 }, ["a", "b"]],
		[42, []],
		[undefined, []],
	])("normalizes %j", (value, expected) => {
		expect(toStrings(value)).toEqual(expected);
	});
});

describe("roleOptions", () => {
	it("prefers explicit options", () => {
		expect(
			roleOptions({ claim: "g", options: ["x"], map: { a: ["y"] } }),
		).toEqual(["x"]);
	});

	it("derives unique roles from a lookup table", () => {
		expect(
			roleOptions({ claim: "g", map: { a: ["x"], b: ["x", "y"] } }),
		).toEqual(["x", "y"]);
	});

	it("cannot derive roles from a function or a missing map", () => {
		expect(roleOptions({ claim: "g", map: () => [] })).toBeUndefined();
		expect(roleOptions({ claim: "g" })).toBeUndefined();
	});
});

describe("resolveRoles", () => {
	const allowed = ["admin", "editor", "viewer"];

	it("maps through a table, dropping unknown and duplicate roles", async () => {
		const roles = await resolveRoles(
			{ claim: "groups", map: { a: ["admin", "ghost"], b: ["admin"] } },
			context({ claims: { sub: "s", groups: ["a", "b", "toString"] } }),
			allowed,
		);

		expect(roles).toEqual(["admin"]);
	});

	it("uses raw values as roles without a map", async () => {
		const roles = await resolveRoles(
			{ claim: "groups" },
			context({ claims: { sub: "s", groups: ["editor", "other"] } }),
			allowed,
		);

		expect(roles).toEqual(["editor"]);
	});

	it("awaits function claims and maps", async () => {
		const roles = await resolveRoles(
			{
				claim: () => Promise.resolve("x"),
				map: (values) => Promise.resolve(values.map(() => "viewer")),
			},
			context(),
			allowed,
		);

		expect(roles).toEqual(["viewer"]);
	});

	it("falls back to default when nothing maps", async () => {
		const roles = await resolveRoles(
			{ claim: "groups", map: {}, default: ["viewer"] },
			context(),
			allowed,
		);

		expect(roles).toEqual(["viewer"]);
	});
});

describe("hasRole", () => {
	const user = { id: 1, roles: ["editor"] } as unknown as AuthenticatedUser;

	it("is true when any of the roles is held", () => {
		expect(hasRole(user, "admin", "editor")).toBe(true);
	});

	it("is false otherwise, and for no user", () => {
		expect(hasRole(user, "admin")).toBe(false);
		expect(hasRole(null, "editor")).toBe(false);
	});
});
