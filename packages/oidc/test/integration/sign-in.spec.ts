import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
	boot,
	cookiesOf,
	me,
	request,
	signIn,
	startProvider,
} from "./helpers/setup.js";

import type { Booted, Provider } from "./helpers/setup.js";

let provider: Provider;
let booted: Booted;

beforeAll(async () => {
	provider = await startProvider();
	booted = await boot(provider);
});

beforeEach(() => {
	provider.identity = {
		sub: "alice",
		email: "alice@example.com",
		name: "Alice",
	};
});

afterAll(async () => {
	await booted.payload.destroy();
	await provider.stop();
});

const usersWithSub = async (sub: string) =>
	(
		await booted.payload.find({
			collection: "users",
			where: { sub: { equals: sub } },
			overrideAccess: true,
		})
	).docs;

describe("sign-in", () => {
	it("creates the user and authenticates the session cookie", async () => {
		const { callback, cookies } = await signIn(booted);

		expect(callback.status).toBe(200);
		expect(await callback.text()).toContain('content="0;url=/admin"');
		expect(await me(booted, cookies)).toMatchObject({
			sub: "alice",
			email: "alice@example.com",
			name: "Alice",
			collection: "users",
		});
	});

	it("updates the same user on the next sign-in", async () => {
		await signIn(booted);
		provider.identity = { ...provider.identity, name: "Alice Liddell" };
		await signIn(booted);

		const docs = await usersWithSub("alice");

		expect(docs).toHaveLength(1);
		expect(docs[0]?.["name"]).toBe("Alice Liddell");
	});

	it("returns to a same-origin redirect target", async () => {
		const { callback } = await signIn(
			booted,
			"/api/users/oidc/login?redirect=%2Fadmin%2Fcollections%2Fusers",
		);

		expect(await callback.text()).toContain("url=/admin/collections/users");
	});

	it("ignores a redirect target on another origin", async () => {
		const { callback } = await signIn(
			booted,
			"/api/users/oidc/login?redirect=%2F%2Fevil.example",
		);

		expect(await callback.text()).toContain('content="0;url=/admin"');
	});

	it("refuses a callback without the flow cookie", async () => {
		const login = await request(booted, "/api/users/oidc/login");
		const authorize = await fetch(login.headers.get("location")!, {
			redirect: "manual",
		});
		const callbackURL = new URL(authorize.headers.get("location")!);
		const callback = await request(
			booted,
			`${callbackURL.pathname}${callbackURL.search}`,
		);

		expect(callback.status).toBe(302);
		expect(callback.headers.get("location")).toBe("/admin/login?oidc=failed");
	});

	it("refuses a callback whose state does not match", async () => {
		const login = await request(booted, "/api/users/oidc/login");
		const authorize = await fetch(login.headers.get("location")!, {
			redirect: "manual",
		});
		const callbackURL = new URL(authorize.headers.get("location")!);

		callbackURL.searchParams.set("state", "forged");

		const callback = await request(
			booted,
			`${callbackURL.pathname}${callbackURL.search}`,
			{ cookies: cookiesOf(login) },
		);

		expect(callback.headers.get("location")).toBe("/admin/login?oidc=failed");
		expect(callback.headers.getSetCookie().join()).toMatch(
			/payload-oidc-flow=; Path=\/api\/users\/oidc; Max-Age=0/,
		);
	});

	it("disables password login", async () => {
		const response = await booted.payload
			.login({
				collection: "users",
				data: { email: "alice@example.com", password: "anything" },
			})
			.then(
				() => "logged in",
				() => "refused",
			);

		expect(response).toBe("refused");
	});

	it("keeps a token from Payload's refresh endpoint working", async () => {
		const { cookies } = await signIn(booted);
		const refreshed = await request(booted, "/api/users/refresh-token", {
			cookies,
			method: "POST",
		});

		expect(refreshed.status).toBe(200);
		expect(await me(booted, cookiesOf(refreshed))).toMatchObject({
			sub: "alice",
		});
	});
});

describe("logout", () => {
	it("clears the session and ends the provider session", async () => {
		const { cookies } = await signIn(booted);
		const logout = await request(booted, "/api/users/oidc/logout", { cookies });
		const location = new URL(logout.headers.get("location")!);

		expect(location.href.startsWith(provider.issuer)).toBe(true);
		expect(location.searchParams.get("post_logout_redirect_uri")).toBe(
			"http://localhost:3000/admin/login?oidc=signed-out",
		);
		expect(logout.headers.getSetCookie().join()).toMatch(/payload-token=;/);
		expect(logout.headers.getSetCookie().join()).toMatch(
			/payload-oidc-bounce=; Path=\/; Max-Age=0/,
		);
	});
});

describe("session age", () => {
	it("stops authenticating once the last sign-in is older than maxSessionAge", async () => {
		const { cookies } = await signIn(booted);
		const [user] = await usersWithSub("alice");

		expect(await me(booted, cookies)).not.toBeNull();

		await booted.payload.update({
			collection: "users",
			id: user!.id,
			data: {
				lastSignInAt: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
			},
			overrideAccess: true,
		});

		expect(await me(booted, cookies)).toBeNull();
	});
});
