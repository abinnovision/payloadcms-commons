import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig, getPayload } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { me, SERVER_URL, signIn, startProvider } from "./helpers/setup.js";
import { oidcPlugin } from "../../src/index.js";

import type { Booted, Provider } from "./helpers/setup.js";

/*
 * Admins sign in at one provider, customers at another: one plugin instance
 * per auth collection, both in the same Payload.
 */
let staff: Provider;
let shop: Provider;
let booted: Booted;

beforeAll(async () => {
	staff = await startProvider();
	shop = await startProvider();

	const cacheKey = "oidc-two-collections";
	const config = buildConfig({
		secret: "oidc-test-secret",
		serverURL: SERVER_URL,
		db: sqliteAdapter({ client: { url: ":memory:" } }),
		admin: { user: "users" },
		collections: [
			{ slug: "users", auth: true, fields: [] },
			{
				slug: "customers",
				auth: true,
				// Payload 4 grants nothing to users outside admin.user by default.
				access: {
					read: ({ req }) =>
						req.user?.collection === "customers"
							? { id: { equals: req.user.id } }
							: Boolean(req.user),
				},
				fields: [],
			},
		],
		telemetry: false,
		plugins: [
			oidcPlugin({
				issuer: staff.issuer,
				clientId: "admin",
				clientSecret: "admin-secret",
				allowInsecureRequests: true,
				roles: { claim: "groups", map: { staff: ["admin"] } },
			}),
			oidcPlugin({
				issuer: shop.issuer,
				clientId: "shop",
				clientSecret: "shop-secret",
				allowInsecureRequests: true,
				collection: "customers",
			}),
		],
	});

	booted = {
		config,
		payload: await getPayload({ config, key: cacheKey }),
		cacheKey,
	};
	// The same subject at both providers, to show the collections stay apart.
	staff.identity = {
		sub: "same-sub",
		email: "ada@staff.test",
		groups: ["staff"],
	};
	shop.identity = { sub: "same-sub", email: "ada@shop.test" };
});

afterAll(async () => {
	await booted.payload.destroy();
	await staff.stop();
	await shop.stop();
});

describe("two auth collections, two providers", () => {
	it("signs each collection in at its own provider", async () => {
		const admin = await signIn(booted, "/api/users/oidc/login");
		const customer = await signIn(booted, "/api/customers/oidc/login");

		expect(await me(booted, admin.cookies, "users")).toMatchObject({
			email: "ada@staff.test",
			roles: ["admin"],
			collection: "users",
		});
		expect(await me(booted, customer.cookies, "customers")).toMatchObject({
			email: "ada@shop.test",
			collection: "customers",
		});
	});

	it("keeps the same subject as two separate users", async () => {
		const read = (collection: "customers" | "users") =>
			booted.payload.find({
				collection,
				where: { sub: { equals: "same-sub" } },
				overrideAccess: true,
			});

		expect((await read("users")).docs.map((doc) => doc["email"])).toEqual([
			"ada@staff.test",
		]);
		expect((await read("customers")).docs.map((doc) => doc["email"])).toEqual([
			"ada@shop.test",
		]);
	});

	it("does not let one collection's session pass as the other's", async () => {
		const customer = await signIn(booted, "/api/customers/oidc/login");

		expect(await me(booted, customer.cookies, "users")).toBeNull();

		const admin = await signIn(booted, "/api/users/oidc/login");

		expect(await me(booted, admin.cookies, "customers")).toBeNull();
	});

	/*
	 * Payload keeps every auth collection's session in the one
	 * `payload-token` cookie, so a browser holds one session at a time.
	 */
	it("replaces the admin session when the same browser signs in as a customer", async () => {
		const jar = new Map<string, string>();
		const keep = (cookies: string) => {
			for (const pair of cookies.split("; ").filter(Boolean)) {
				const [name, ...value] = pair.split("=");

				jar.set(name!, value.join("="));
			}
		};

		const header = () =>
			[...jar].map(([name, value]) => `${name}=${value}`).join("; ");

		keep((await signIn(booted, "/api/users/oidc/login")).cookies);
		expect(await me(booted, header(), "users")).not.toBeNull();

		keep((await signIn(booted, "/api/customers/oidc/login")).cookies);
		expect(await me(booted, header(), "users")).toBeNull();
		expect(await me(booted, header(), "customers")).toMatchObject({
			collection: "customers",
		});
	});

	it("adds the customers fields without roles, and no admin components for it", async () => {
		const config = await booted.config;
		const names = (slug: string) =>
			config.collections
				.find((collection) => collection.slug === slug)!
				.fields.flatMap((field) => ("name" in field ? [field.name] : []));

		expect(names("customers")).toEqual(
			expect.arrayContaining(["sub", "email", "name", "lastSignInAt"]),
		);
		expect(names("customers")).not.toContain("roles");
		expect(names("users")).toContain("roles");
		expect(config.admin.components.beforeLogin).toHaveLength(1);
	});
});
