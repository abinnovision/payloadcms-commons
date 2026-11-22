import { strategyAuthOf, withMcpxAuth } from "@abinnovision/payloadcms-mcpx";
import { Forbidden } from "payload";

import { liveWindow, readToken } from "./store.js";
import { admits } from "../threads/resolve.js";

import type { NormalizedOptions } from "../options.js";
import type {
	AuthStrategy,
	AuthStrategyResult,
	CollectionBeforeOperationHook,
	CollectionMeHook,
	DefaultDocumentIDType,
	Payload,
	PayloadRequest,
} from "payload";

type TypedUser = NonNullable<PayloadRequest["user"]>;

/** The name of the auth strategy that authenticates agent tokens. */
const FLUE_TOKEN_STRATEGY = "flue-token";

const THREAD_PRINCIPAL = "flue-thread:";

const BEARER = /^Bearer (flue_\S+)$/;

const NONE: AuthStrategyResult = { user: null };

const toTime = (value: unknown): number =>
	typeof value === "string" ? Date.parse(value) : Number.NaN;

/*
 * The user, unless it is gone, unverified or locked out. `lockUntil` is
 * hidden, so it is read on its own rather than showing hidden fields on the
 * user that becomes `req.user`.
 */
const activeUser = async (
	payload: Payload,
	collection: string,
	id: DefaultDocumentIDType,
): Promise<null | Record<string, unknown>> => {
	const lookup = { collection, id, overrideAccess: true, disableErrors: true };
	// Typed as found, but `disableErrors` answers `null` for a missing user.
	const [user, lock]: (null | Record<string, unknown>)[] = await Promise.all([
		payload.findByID({
			...lookup,
			depth: payload.collections[collection]?.config.auth.depth ?? 0,
		}),
		payload.findByID({
			...lookup,
			depth: 0,
			showHiddenFields: true,
			select: { lockUntil: true },
		}),
	]);

	if (
		!user ||
		user["_verified"] === false ||
		toTime(lock?.["lockUntil"]) > Date.now()
	) {
		return null;
	}

	return user;
};

/**
 * The `flue-token` auth strategy. A `Bearer flue_…` token whose thread's live
 * window is still the one it was minted under, of an agent still configured
 * whose `access` still admits the user of a chat thread, authenticates as the
 * thread's user, with the agent's capabilities handed to mcpx under the
 * thread's principal. Any other header is ignored without a database read.
 * Never throws and never logs the token.
 */
export const createTokenStrategy = (
	settings: Pick<NormalizedOptions, "agents" | "mcpx">,
): AuthStrategy => ({
	name: FLUE_TOKEN_STRATEGY,
	authenticate: async ({ headers, payload }) => {
		const token = BEARER.exec(headers.get("authorization") ?? "")?.[1];

		if (token === undefined) {
			return NONE;
		}

		try {
			const grant = await readToken(payload, token);
			const agent =
				grant && settings.agents.find((entry) => entry.slug === grant.agent);

			if (
				!grant ||
				!agent ||
				(await liveWindow(payload, grant))?.gen !== grant.gen
			) {
				return NONE;
			}

			const { userCollection } = settings.mcpx;
			const found = await activeUser(payload, userCollection, grant.user);

			if (!found) {
				return NONE;
			}

			const loaded = { ...found, collection: userCollection };
			const user = loaded as TypedUser;

			if (grant.kind === "chat" && !(await admits(payload, agent, user))) {
				return NONE;
			}

			return {
				user: withMcpxAuth(
					{ ...user, _strategy: FLUE_TOKEN_STRATEGY },
					{
						principal: `${THREAD_PRINCIPAL}${String(grant.thread)}`,
						capabilities: agent.capabilities,
					},
				),
			};
		} catch (error) {
			payload.logger.error({
				err: error,
				msg: "[payloadcms-flue] Could not check an agent token; the request is not authenticated by it.",
			});

			return NONE;
		}
	},
});

/** Whether `req` is authenticated by an agent token. */
export const isTokenRequest = (req: Pick<PayloadRequest, "user">): boolean =>
	req.user?._strategy === FLUE_TOKEN_STRATEGY;

/**
 * The thread an agent token authenticates `req` for, or `undefined` for any
 * other request.
 */
export const flueTokenThread = (
	req: Pick<PayloadRequest, "user">,
): string | undefined => {
	const principal = isTokenRequest(req)
		? strategyAuthOf(req.user)?.principal
		: undefined;

	return principal?.startsWith(THREAD_PRINCIPAL)
		? principal.slice(THREAD_PRINCIPAL.length)
		: undefined;
};

/** Refuses the refresh operation to an agent token, so it cannot become a JWT. */
export const refuseTokenRefresh: CollectionBeforeOperationHook = (hookArgs) => {
	// The argument union carries a deprecated `read` member, which is what the rule reacts to.
	// eslint-disable-next-line @typescript-eslint/no-deprecated
	const { operation, req } = hookArgs;

	if (operation === "refresh" && isTokenRequest(req)) {
		throw new Forbidden(req.t);
	}
};

/*
 * Answers `/me` for an agent token with the token's expiry. Payload's own
 * answer decodes the bearer as a JWT, which a token is not.
 */
export const tokenMe: CollectionMeHook = async (hookArgs) => {
	const { args } = hookArgs;
	const token = BEARER.exec(args.req.headers.get("authorization") ?? "")?.[1];

	if (!isTokenRequest(args.req) || token === undefined) {
		return undefined;
	}

	const grant = await readToken(args.req.payload, token);

	return (
		grant && {
			user: hookArgs.user as unknown,
			exp: Math.floor(grant.exp / 1000),
		}
	);
};
