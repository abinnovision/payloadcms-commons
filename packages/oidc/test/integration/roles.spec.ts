import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { boot, me, signIn, startProvider } from "./helpers/setup.js";

import type { Booted, Provider } from "./helpers/setup.js";
import type { OidcPluginOptions } from "../../src/index.js";
import type { CollectionConfig } from "payload";

let provider: Provider;
let booted: Booted | undefined;

beforeAll(async () => {
	provider = await startProvider();
});

afterEach(async () => {
	await booted?.payload.destroy();
	booted = undefined;
});

afterAll(async () => {
	await provider.stop();
});

const start = async (
	options: Partial<OidcPluginOptions>,
	collection?: CollectionConfig,
): Promise<Booted> => {
	booted = await boot(provider, options, collection);

	return booted;
};

const rolesAfterSignIn = async (instance: Booted): Promise<unknown> => {
	const { cookies } = await signIn(instance);

	return (await me(instance, cookies))?.["roles"];
};

describe("role mapping", () => {
	it("maps a claim through a lookup table", async () => {
		const instance = await start({
			roles: {
				claim: "groups",
				map: { "cms-admins": ["admin"], "cms-editors": ["editor"] },
			},
		});

		provider.identity = { sub: "a", groups: ["cms-editors", "unrelated"] };

		expect(await rolesAfterSignIn(instance)).toEqual(["editor"]);
	});

	it("reads a nested path from the userinfo response", async () => {
		const instance = await start({
			roles: {
				claim: ["realm_access", "roles"],
				options: ["admin", "editor"],
			},
		});

		provider.identity = {
			sub: "b",
			userinfo: { realm_access: { roles: ["admin", "offline_access"] } },
		};

		expect(await rolesAfterSignIn(instance)).toEqual(["admin"]);
	});

	it("takes the keys of an object claim", async () => {
		const instance = await start({
			roles: {
				claim: "urn:zitadel:iam:org:project:roles",
				options: ["admin", "editor"],
			},
		});

		provider.identity = {
			sub: "c",
			userinfo: {
				"urn:zitadel:iam:org:project:roles": { editor: { org: "acme" } },
			},
		};

		expect(await rolesAfterSignIn(instance)).toEqual(["editor"]);
	});

	it("maps through a function with the whole sign-in context", async () => {
		const instance = await start({
			roles: {
				claim: (context) => context.claims["email"],
				map: (values) =>
					values.some((value) => value.endsWith("@acme.test")) ? ["admin"] : [],
				options: ["admin"],
			},
		});

		provider.identity = { sub: "d", email: "d@acme.test" };

		expect(await rolesAfterSignIn(instance)).toEqual(["admin"]);
	});

	it("overwrites stored roles when the provider changes them", async () => {
		const instance = await start({
			roles: { claim: "groups", map: { a: ["admin"], e: ["editor"] } },
		});

		provider.identity = { sub: "e", groups: ["a"] };
		await signIn(instance);
		provider.identity = { sub: "e", groups: ["e"] };

		expect(await rolesAfterSignIn(instance)).toEqual(["editor"]);
	});

	it("refuses a user without roles and creates nothing", async () => {
		const instance = await start({
			roles: { claim: "groups", map: { a: ["admin"] } },
		});

		provider.identity = { sub: "f", groups: ["other"] };

		const { callback } = await signIn(instance);
		const { totalDocs } = await instance.payload.count({
			collection: "users",
			overrideAccess: true,
		});

		expect(callback.headers.get("location")).toBe("/admin/login?oidc=denied");
		expect(totalDocs).toBe(0);
	});

	it("falls back to default roles", async () => {
		const instance = await start({
			roles: {
				claim: "groups",
				map: { a: ["admin"] },
				default: ["viewer"],
				options: ["admin", "viewer"],
			},
		});

		provider.identity = { sub: "g", groups: [] };

		expect(await rolesAfterSignIn(instance)).toEqual(["viewer"]);
	});

	it("writes to an existing roles field and keeps to its options", async () => {
		const instance = await start(
			{ roles: { claim: "groups" } },
			{
				slug: "users",
				auth: true,
				fields: [
					{
						name: "roles",
						type: "select",
						hasMany: true,
						options: ["owner", "member"],
					},
				],
			},
		);

		provider.identity = { sub: "h", groups: ["member", "admin"] };

		expect(await rolesAfterSignIn(instance)).toEqual(["member"]);
	});

	it("does not let users change an existing roles field either", async () => {
		const instance = await start(
			{ roles: { claim: "groups" } },
			{
				slug: "users",
				auth: true,
				fields: [
					{
						name: "roles",
						type: "select",
						hasMany: true,
						options: ["owner", "member"],
					},
				],
			},
		);

		provider.identity = { sub: "l", groups: ["member"] };

		const { cookies } = await signIn(instance);
		const user = await me(instance, cookies);
		const updated = await instance.payload.update({
			collection: "users",
			id: user!["id"] as number,
			data: { roles: ["owner"], lastSignInAt: new Date().toISOString() },
			user: user as never,
			overrideAccess: false,
		});

		expect(updated["roles"]).toEqual(["member"]);
		expect(updated["lastSignInAt"]).toBe(user!["lastSignInAt"]);
	});

	it("does not let users change their roles through the API", async () => {
		const instance = await start({
			roles: { claim: "groups", map: { a: ["admin"], e: ["editor"] } },
		});

		provider.identity = { sub: "i", groups: ["e"] };

		const { cookies } = await signIn(instance);
		const user = await me(instance, cookies);
		const updated = await instance.payload.update({
			collection: "users",
			id: user!["id"] as number,
			data: { roles: ["admin"], sub: "someone-else" },
			user: user as never,
			overrideAccess: false,
		});

		expect(updated["roles"]).toEqual(["editor"]);
		expect(updated["sub"]).toBe("i");
	});
});

describe("allow and mapUser", () => {
	it("refuses a sign-in that allow rejects", async () => {
		const instance = await start({
			allow: ({ claims }) => claims["email"] === "ok@example.com",
		});

		provider.identity = { sub: "j", email: "nope@example.com" };

		const { callback } = await signIn(instance);

		expect(callback.headers.get("location")).toBe("/admin/login?oidc=denied");
	});

	it("writes extra fields from mapUser", async () => {
		const instance = await start(
			{ mapUser: ({ claims }) => ({ locale: claims["locale"] }) },
			{
				slug: "users",
				auth: true,
				fields: [{ name: "locale", type: "text" }],
			},
		);

		provider.identity = { sub: "k", locale: "de" };

		const { cookies } = await signIn(instance);

		expect((await me(instance, cookies))?.["locale"]).toBe("de");
	});
});
