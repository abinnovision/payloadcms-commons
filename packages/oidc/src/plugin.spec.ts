import { describe, expect, it } from "vitest";

import { LOGIN_COMPONENT, LOGOUT_COMPONENT, oidcPlugin } from "./plugin.js";

import type { OidcPluginOptions } from "./options.js";
import type { CollectionConfig, Config, Field } from "payload";

const options: OidcPluginOptions = {
	issuer: "https://idp.example",
	clientId: "client",
	clientSecret: "secret",
};

const users: CollectionConfig = { slug: "users", auth: true, fields: [] };

const run = (
	config: Partial<Config> = {},
	args: Partial<OidcPluginOptions> = {},
): Config => {
	const input = {
		serverURL: "https://cms.example",
		collections: [users],
		...config,
	};

	return oidcPlugin({ ...options, ...args })(input as Config) as Config;
};

const usersOf = (config: Config): CollectionConfig =>
	config.collections!.find((collection) => collection.slug === "users")!;

const fieldNames = (config: Config): string[] =>
	usersOf(config).fields.map((field: Field) =>
		"name" in field ? field.name : "",
	);

describe("oidcPlugin", () => {
	it("disables password login and sessions, and adds the strategy", () => {
		const auth = usersOf(run()).auth as Exclude<
			CollectionConfig["auth"],
			boolean
		>;

		expect(auth?.disableLocalStrategy).toBe(true);
		expect(auth?.useSessions).toBe(false);
		expect(auth?.strategies?.map((strategy) => strategy.name)).toEqual([
			"oidc",
		]);
	});

	it("adds the managed fields", () => {
		expect(fieldNames(run())).toEqual(["sub", "email", "name", "lastSignInAt"]);
	});

	it("keeps fields the collection already defines", () => {
		const config = run({
			collections: [
				{
					...users,
					fields: [{ name: "email", type: "email", required: true }],
				},
			],
		});

		expect(fieldNames(config)).toEqual([
			"email",
			"sub",
			"name",
			"lastSignInAt",
		]);
	});

	it("adds a roles select with the options of a lookup table", () => {
		const roles = usersOf(
			run({}, { roles: { claim: "g", map: { a: ["admin"], b: ["editor"] } } }),
		).fields.find((field) => "name" in field && field.name === "roles");

		expect(roles).toMatchObject({
			type: "select",
			hasMany: true,
			options: ["admin", "editor"],
		});
	});

	it("requires role options it cannot derive", () => {
		expect(() => run({}, { roles: { claim: "g", map: () => [] } })).toThrow(
			/`roles.options` is required/,
		);
	});

	it("rejects an existing roles field that is not a multi-select", () => {
		expect(() =>
			run(
				{
					collections: [
						{ ...users, fields: [{ name: "roles", type: "text" }] },
					],
				},
				{ roles: { claim: "g" } },
			),
		).toThrow(/must be a select field/);
	});

	it("mounts the endpoints under /oidc", () => {
		const endpoints = usersOf(run()).endpoints;

		expect(
			Array.isArray(endpoints) && endpoints.map((endpoint) => endpoint.path),
		).toEqual(["/oidc/login", "/oidc/callback", "/oidc/logout"]);
	});

	it("mounts the login component and replaces the logout button", () => {
		const components = run({ routes: { api: "/cms-api" } }).admin?.components;

		expect(components?.beforeLogin).toEqual([
			{
				path: LOGIN_COMPONENT,
				serverProps: {
					loginURL: "/cms-api/users/oidc/login",
					autoRedirect: true,
				},
			},
		]);
		expect(components?.logout?.Button).toEqual({
			path: LOGOUT_COMPONENT,
			clientProps: { logoutURL: "/cms-api/users/oidc/logout" },
		});
	});

	it("keeps a logout button the app already configured", () => {
		const components = run({
			admin: { components: { logout: { Button: "app#Logout" } } },
		}).admin?.components;

		expect(components?.logout?.Button).toBe("app#Logout");
	});

	it("takes over the collection named by admin.user", () => {
		const admins: CollectionConfig = { slug: "admins", auth: true, fields: [] };
		const config = run({
			collections: [users, admins],
			admin: { user: "admins" },
		});
		const auth = config.collections!.find((c) => c.slug === "admins")!.auth;

		expect(auth).toMatchObject({ disableLocalStrategy: true });
		expect(usersOf(config).auth).toBe(true);
	});

	it("fails without an auth collection or a server URL", () => {
		expect(() => run({ collections: [] })).toThrow(/No auth collection/);
		expect(() =>
			run({
				collections: [{ slug: "users", fields: [] }],
				admin: { user: "users" },
			}),
		).toThrow(/No auth collection "users"/);
		expect(() => run({ serverURL: "" })).toThrow(/Set `serverURL`/);
	});

	it("validates its options where the config is evaluated", () => {
		expect(() => oidcPlugin({ ...options, issuer: "" })).toThrow(
			/`issuer` is required/,
		);
		expect(() => oidcPlugin({ ...options, issuer: "not a url" })).toThrow(
			/absolute URL/,
		);
		expect(() => oidcPlugin({ ...options, maxSessionAge: 0 })).toThrow(
			/maxSessionAge/,
		);
	});

	it("defaults to the first auth collection, as Payload does", () => {
		const admins: CollectionConfig = { slug: "admins", auth: true, fields: [] };
		const config = run({
			collections: [{ slug: "pages", fields: [] }, admins],
		});

		expect(
			config.collections!.find((c) => c.slug === "admins")!.auth,
		).toMatchObject({
			disableLocalStrategy: true,
		});
		expect(config.admin?.components?.beforeLogin).toHaveLength(1);
	});

	it("leaves the admin login alone for a collection other than admin.user", () => {
		const customers: CollectionConfig = {
			slug: "customers",
			auth: true,
			fields: [],
		};
		const config = run(
			{ collections: [users, customers], admin: { user: "users" } },
			{ collection: "customers" },
		);

		expect(config.admin?.components?.beforeLogin).toBeUndefined();
		expect(config.admin?.components?.logout).toBeUndefined();
	});

	it("takes write access away from existing sub, roles and lastSignInAt fields", () => {
		const config = run(
			{
				collections: [
					{
						...users,
						fields: [
							{
								name: "roles",
								type: "select",
								hasMany: true,
								options: ["owner"],
								access: { read: () => true },
							},
							{ name: "lastSignInAt", type: "date" },
							{ name: "title", type: "text" },
						],
					},
				],
			},
			{ roles: { claim: "g" } },
		);
		const byName = (name: string) =>
			usersOf(config).fields.find(
				(field) => "name" in field && field.name === name,
			) as {
				access?: Record<string, (() => boolean) | undefined>;
			};

		expect(byName("roles").access?.["update"]?.()).toBe(false);
		expect(byName("roles").access?.["read"]?.()).toBe(true);
		expect(byName("lastSignInAt").access?.["create"]?.()).toBe(false);
		expect(byName("title").access).toBeUndefined();
	});

	it("rejects a managed field nested in a layout field", () => {
		expect(() =>
			run({
				collections: [
					{
						...users,
						fields: [
							{ type: "row", fields: [{ name: "email", type: "email" }] },
						],
					},
				],
			}),
		).toThrow(/`email` field on "users" must be a top-level field/);
	});

	it("marks the session cookie Secure on an HTTPS server URL", () => {
		const auth = usersOf(run()).auth as Exclude<
			CollectionConfig["auth"],
			boolean
		>;

		expect(auth?.cookies?.secure).toBe(true);
		expect(
			(usersOf(run({ serverURL: "http://localhost:3000" })).auth as typeof auth)
				?.cookies?.secure,
		).toBe(false);
	});

	it("identifies itself to Payload", () => {
		expect(oidcPlugin(options).slug).toBe("oidc");
	});
});
