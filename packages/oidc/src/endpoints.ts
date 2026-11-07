import { decodeJwt } from "jose";
import * as client from "openid-client";
import { generateExpiredPayloadCookie, generatePayloadCookie } from "payload";
import { getSafeRedirect, parseCookies } from "payload/shared";

import { resolveRoles, ROLES_FIELD } from "./roles.js";
import { SIGNED_IN_AT_FIELD, signSessionToken } from "./session.js";
import { bounceCookieName } from "./status.js";

import type { OidcSignInContext } from "./context.js";
import type { OidcPluginOptions } from "./options.js";
import type { OidcStatus } from "./status.js";
import type {
	Endpoint,
	PayloadRequest,
	SanitizedCollectionConfig,
} from "payload";

/** Values the endpoints need, resolved once from the options and the config. */
export interface OidcSettings {
	options: OidcPluginOptions;
	slug: string;
	scopes: readonly string[];
	/** `${serverURL}${api}/${slug}/oidc`, the absolute base of the endpoints. */
	endpointURL: string;
	/** The admin login page, as a path. */
	loginPath: string;
	/** The admin root, as a path. */
	adminPath: string;
	/** Roles the `roles` field accepts; undefined without role mapping. */
	allowedRoles: readonly string[] | undefined;
}

const FLOW_MAX_AGE = 10 * 60;

const BOUNCE_MAX_AGE = 30;

const flowCookieName = (cookiePrefix: string): string =>
	`${cookiePrefix}-oidc-flow`;

interface Flow {
	verifier: string;
	state: string;
	nonce: string;
	redirect: string;
}

const serializeCookie = (args: {
	name: string;
	value: string;
	path: string;
	maxAge: number;
	secure: boolean;
}): string =>
	[
		`${args.name}=${args.value}`,
		`Path=${args.path}`,
		`Max-Age=${String(args.maxAge)}`,
		"HttpOnly",
		"SameSite=Lax",
		...(args.secure ? ["Secure"] : []),
	].join("; ");

const readFlow = (req: PayloadRequest, name: string): Flow | undefined => {
	const raw = parseCookies(req.headers).get(name);

	if (!raw) {
		return undefined;
	}

	try {
		const flow = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as
			Partial<Flow> | undefined;

		return typeof flow?.verifier === "string" &&
			typeof flow.state === "string" &&
			typeof flow.nonce === "string" &&
			typeof flow.redirect === "string"
			? (flow as Flow)
			: undefined;
	} catch {
		return undefined;
	}
};

/**
 * Accepts only a same-origin path, so `?redirect=` cannot send anyone
 * elsewhere. Payload's own check, which also rejects encoded and control
 * characters that browsers strip into `//host`.
 */
export const safeRedirect = (value: unknown, fallback: string): string =>
	typeof value === "string"
		? getSafeRedirect({ redirectTo: value, fallbackTo: fallback })
		: fallback;

const escapeHtml = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

const redirect = (location: string, cookies: string[] = []): Response => {
	const headers = new Headers({ Location: location });

	for (const cookie of cookies) {
		headers.append("Set-Cookie", cookie);
	}

	return new Response(null, { status: 302, headers });
};

const withStatus = (path: string, status: OidcStatus): string =>
	`${path}?oidc=${status}`;

const stringClaim = (...values: unknown[]): string | undefined =>
	values.find((value): value is string => typeof value === "string");

const decodeAccessToken = (
	token: string,
): Record<string, unknown> | undefined => {
	try {
		return decodeJwt(token);
	} catch {
		return undefined;
	}
};

/**
 * Discovery runs on the first request rather than when the config loads, so
 * the CLI, migrations and type generation never reach the provider. A failed
 * discovery is retried on the next request.
 */
const createClient = (
	options: OidcPluginOptions,
): (() => Promise<client.Configuration>) => {
	let pending: Promise<client.Configuration> | undefined;

	return () => {
		pending ??= client
			.discovery(
				new URL(options.issuer),
				options.clientId,
				options.clientSecret,
				undefined,
				options.allowInsecureRequests
					? // eslint-disable-next-line @typescript-eslint/no-deprecated -- opt-in for local development providers
						{ execute: [client.allowInsecureRequests] }
					: undefined,
			)
			.catch((error: unknown) => {
				pending = undefined;
				throw error;
			});

		return pending;
	};
};

/**
 * The three endpoints mounted on the auth collection under `/oidc`.
 */
export const createEndpoints = (settings: OidcSettings): Endpoint[] => {
	const { options, slug } = settings;
	const getClient = createClient(options);
	const callbackURL = `${settings.endpointURL}/callback`;
	const endpointPath = new URL(settings.endpointURL).pathname;
	const secure = settings.endpointURL.startsWith("https:");
	const collectionOf = (req: PayloadRequest): SanitizedCollectionConfig => {
		const collection = req.payload.collections[slug];

		if (!collection) {
			throw new Error(`[payloadcms-oidc] Collection "${slug}" is not loaded.`);
		}

		return collection.config;
	};

	const signIn = async (req: PayloadRequest, flow: Flow): Promise<Response> => {
		const config = await getClient();
		/*
		 * Built from the registered redirect URI, not `req.url`, which behind a
		 * proxy carries the internal origin and would fail the provider's match.
		 */
		const currentURL = new URL(callbackURL);

		currentURL.search = new URL(req.url ?? callbackURL).search;

		const tokens = await client.authorizationCodeGrant(config, currentURL, {
			pkceCodeVerifier: flow.verifier,
			expectedState: flow.state,
			expectedNonce: flow.nonce,
			idTokenExpected: true,
		});
		const claims = tokens.claims() as OidcSignInContext["claims"];
		const userinfo = config.serverMetadata().userinfo_endpoint
			? ((await client.fetchUserInfo(
					config,
					tokens.access_token,
					claims.sub,
				)) as Record<string, unknown>)
			: undefined;
		const context: OidcSignInContext = {
			claims,
			userinfo,
			accessToken: decodeAccessToken(tokens.access_token),
			req,
		};

		if (options.allow && !(await options.allow(context))) {
			return redirect(withStatus(settings.loginPath, "denied"));
		}

		const roles =
			options.roles && settings.allowedRoles
				? await resolveRoles(options.roles, context, settings.allowedRoles)
				: undefined;

		if (roles?.length === 0) {
			return redirect(withStatus(settings.loginPath, "denied"));
		}

		const email = stringClaim(claims["email"], userinfo?.["email"]);
		const name = stringClaim(claims["name"], userinfo?.["name"]);
		const data: Record<string, unknown> = {
			...(email === undefined ? {} : { email }),
			...(name === undefined ? {} : { name }),
			...(await options.mapUser?.(context)),
			sub: claims.sub,
			[SIGNED_IN_AT_FIELD]: new Date().toISOString(),
			...(roles ? { [ROLES_FIELD]: roles } : {}),
		};

		const {
			docs: [existing],
		} = await req.payload.find({
			collection: slug,
			where: { sub: { equals: claims.sub } },
			limit: 1,
			depth: 0,
			overrideAccess: true,
			req,
		});
		const user = existing
			? await req.payload.update({
					collection: slug,
					id: existing.id,
					data,
					depth: 0,
					overrideAccess: true,
					req,
				})
			: await req.payload.create({
					collection: slug,
					data,
					depth: 0,
					overrideAccess: true,
					req,
				});

		const collection = collectionOf(req);
		const token = await signSessionToken(req.payload, collection, user);
		const { cookiePrefix } = req.payload.config;
		const target = escapeHtml(safeRedirect(flow.redirect, settings.adminPath));

		/*
		 * Answered with a page rather than a 302: the follow-up navigation is
		 * then same-origin, so Payload's CSRF check and a `Strict` cookie both
		 * accept the new session cookie.
		 */
		const headers = new Headers({
			"Cache-Control": "no-store",
			"Content-Type": "text/html; charset=utf-8",
			"Referrer-Policy": "no-referrer",
		});

		headers.append(
			"Set-Cookie",
			generatePayloadCookie({
				collectionAuthConfig: collection.auth,
				cookiePrefix,
				token,
			}),
		);
		headers.append(
			"Set-Cookie",
			serializeCookie({
				name: bounceCookieName(cookiePrefix),
				value: "1",
				path: "/",
				maxAge: BOUNCE_MAX_AGE,
				secure,
			}),
		);

		return new Response(
			`<!doctype html><meta http-equiv="refresh" content="0;url=${target}"><a href="${target}">Continue</a>`,
			{ status: 200, headers },
		);
	};

	return [
		{
			path: "/oidc/login",
			method: "get",
			handler: async (req) => {
				const config = await getClient();
				const flow: Flow = {
					verifier: client.randomPKCECodeVerifier(),
					state: client.randomState(),
					nonce: client.randomNonce(),
					redirect: safeRedirect(
						req.searchParams.get("redirect"),
						settings.adminPath,
					),
				};
				const url = client.buildAuthorizationUrl(config, {
					redirect_uri: callbackURL,
					scope: settings.scopes.join(" "),
					state: flow.state,
					nonce: flow.nonce,
					code_challenge: await client.calculatePKCECodeChallenge(
						flow.verifier,
					),
					code_challenge_method: "S256",
				});

				return redirect(url.href, [
					serializeCookie({
						name: flowCookieName(req.payload.config.cookiePrefix),
						value: Buffer.from(JSON.stringify(flow)).toString("base64url"),
						path: endpointPath,
						maxAge: FLOW_MAX_AGE,
						secure,
					}),
				]);
			},
		},
		{
			path: "/oidc/callback",
			method: "get",
			handler: async (req) => {
				const name = flowCookieName(req.payload.config.cookiePrefix);
				const flow = readFlow(req, name);
				let response: Response;

				try {
					if (!flow) {
						throw new Error("No sign-in in progress for this browser.");
					}

					response = await signIn(req, flow);
				} catch (error) {
					req.payload.logger.error({ err: error, msg: "OIDC sign-in failed" });
					response = redirect(withStatus(settings.loginPath, "failed"));
				}

				// Every callback ends the flow, whether it signed in, refused or failed.
				response.headers.append(
					"Set-Cookie",
					serializeCookie({
						name,
						value: "",
						path: endpointPath,
						maxAge: 0,
						secure,
					}),
				);

				return response;
			},
		},
		{
			path: "/oidc/logout",
			method: "get",
			handler: async (req) => {
				const signedOut = withStatus(settings.loginPath, "signed-out");
				const { cookiePrefix } = req.payload.config;
				const cookies = [
					generateExpiredPayloadCookie({
						collectionAuthConfig: collectionOf(req).auth,
						cookiePrefix,
					}),
					// A sign-out right after a sign-in must not read as a failed one.
					serializeCookie({
						name: bounceCookieName(cookiePrefix),
						value: "",
						path: "/",
						maxAge: 0,
						secure,
					}),
				];

				try {
					const config = await getClient();

					if (config.serverMetadata().end_session_endpoint) {
						const url = client.buildEndSessionUrl(config, {
							post_logout_redirect_uri: new URL(signedOut, settings.endpointURL)
								.href,
						});

						return redirect(url.href, cookies);
					}
				} catch (error) {
					req.payload.logger.warn({
						err: error,
						msg: "OIDC provider logout unavailable, signing out locally",
					});
				}

				return redirect(signedOut, cookies);
			},
		},
	];
};
