import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { OAuth2Server } from "oauth2-mock-server";
import { buildConfig, getPayload, handleEndpoints } from "payload";

import { oidcPlugin } from "../../../src/index.js";

import type { OidcPluginOptions } from "../../../src/index.js";
import type { CollectionConfig, Payload, SanitizedConfig } from "payload";

export const SERVER_URL = "http://localhost:3000";

/** The person the mock provider signs in, changed per test. */
export interface Identity {
	sub: string;
	email?: string;
	name?: string;
	groups?: string[];
	/** Claims only the userinfo endpoint returns. */
	userinfo?: Record<string, unknown>;
	/** Any further ID and access token claims. */
	[claim: string]: unknown;
}

export interface Provider {
	issuer: string;
	identity: Identity;
	stop: () => Promise<void>;
}

/**
 * A local OpenID provider. Every token and userinfo response describes
 * `provider.identity` at the time of the request.
 */
export const startProvider = async (): Promise<Provider> => {
	const server = new OAuth2Server();

	await server.issuer.keys.generate("RS256");
	await server.start(0, "localhost");

	const provider: Provider = {
		issuer: server.issuer.url!,
		identity: { sub: "alice" },
		stop: () => server.stop(),
	};

	server.service.on("beforeTokenSigning", (token: { payload: object }) => {
		const { userinfo: _userinfo, ...claims } = provider.identity;

		Object.assign(token.payload, claims);
	});
	server.service.on("beforeUserinfo", (response: { body: object }) => {
		response.body = {
			sub: provider.identity.sub,
			...provider.identity.userinfo,
		};
	});

	return provider;
};

export interface Booted {
	config: Promise<SanitizedConfig>;
	payload: Payload;
	cacheKey: string;
}

const users: CollectionConfig = {
	slug: "users",
	auth: true,
	fields: [],
};

let instance = 0;

/**
 * A fresh Payload on an in-memory database with the plugin pointed at the
 * mock provider.
 */
export const boot = async (
	provider: Provider,
	options: Partial<OidcPluginOptions> = {},
	collection: CollectionConfig = users,
): Promise<Booted> => {
	instance += 1;

	const cacheKey = `oidc-integration-${String(instance)}`;
	const config = buildConfig({
		secret: "oidc-test-secret",
		serverURL: SERVER_URL,
		db: sqliteAdapter({ client: { url: ":memory:" } }),
		collections: [collection],
		admin: { user: collection.slug },
		telemetry: false,
		plugins: [
			oidcPlugin({
				issuer: provider.issuer,
				clientId: "payload",
				clientSecret: "payload-secret",
				allowInsecureRequests: true,
				...options,
			}),
		],
	});
	const payload = await getPayload({ config, key: cacheKey });

	return { config, payload, cacheKey };
};

/**
 * One request through Payload's router, the path a route handler takes. Sent
 * as a same-origin browser request, which Payload's CSRF check requires before
 * it accepts the session cookie.
 */
export const request = (
	booted: Booted,
	path: string,
	init: { cookies?: string; method?: string } = {},
): Promise<Response> =>
	handleEndpoints({
		config: booted.config,
		payloadInstanceCacheKey: booted.cacheKey,
		request: new Request(new URL(path, SERVER_URL), {
			method: init.method ?? "GET",
			headers: {
				"sec-fetch-site": "same-origin",
				...(init.cookies ? { cookie: init.cookies } : {}),
			},
		}),
	});

/** The `name=value` pairs a response sets, ready for a `Cookie` header. */
export const cookiesOf = (response: Response): string =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.filter((pair) => pair !== undefined && !pair.endsWith("="))
		.join("; ");

export interface SignIn {
	/** The callback's response. */
	callback: Response;
	/** Cookies the browser holds after the callback. */
	cookies: string;
}

/**
 * Walks the browser's part of a sign-in: plugin login endpoint, provider
 * authorize endpoint, plugin callback.
 */
export const signIn = async (
	booted: Booted,
	path = "/api/users/oidc/login",
): Promise<SignIn> => {
	const login = await request(booted, path);
	const authorize = await fetch(login.headers.get("location")!, {
		redirect: "manual",
	});
	const callbackURL = new URL(authorize.headers.get("location")!);
	const callback = await request(
		booted,
		`${callbackURL.pathname}${callbackURL.search}`,
		{ cookies: cookiesOf(login) },
	);

	return { callback, cookies: cookiesOf(callback) };
};

/** The user `GET /api/<collection>/me` resolves for the cookies. */
export const me = async (
	booted: Booted,
	cookies: string,
	collection = "users",
): Promise<Record<string, unknown> | null> => {
	const response = await request(booted, `/api/${collection}/me`, { cookies });
	const body = (await response.json()) as {
		user: Record<string, unknown> | null;
	};

	return body.user;
};
