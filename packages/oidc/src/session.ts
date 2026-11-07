import { jwtVerify } from "jose";
import {
	extractJWT,
	getFieldsToSign,
	JWT_AUTH_VERSION,
	jwtSign,
} from "payload";

import type {
	AuthStrategy,
	JsonObject,
	Payload,
	SanitizedCollectionConfig,
	TypeWithID,
} from "payload";

export const STRATEGY_NAME = "oidc";

/** The date field recording the last sign-in through the provider. */
export const SIGNED_IN_AT_FIELD = "lastSignInAt";

/**
 * Signs the session token for a user with Payload's own fields to sign, the
 * same shape its refresh operation produces, so a refreshed token keeps
 * authenticating.
 */
export const signSessionToken = async (
	payload: Payload,
	collection: SanitizedCollectionConfig,
	user: JsonObject & TypeWithID,
): Promise<string> => {
	const { token } = await jwtSign({
		fieldsToSign: getFieldsToSign({
			collectionConfig: collection,
			email: typeof user["email"] === "string" ? user["email"] : "",
			user: { ...user, collection: collection.slug },
		}),
		secret: payload.secret,
		tokenExpiration: collection.auth.tokenExpiration,
	});

	return token;
};

/**
 * Verifies against every secret in Payload's keyring, so tokens signed before a
 * secret rotation stay valid for as long as Payload accepts the old secret.
 */
const verifySessionToken = async (
	payload: Payload,
	token: string,
): Promise<Record<string, unknown> | undefined> => {
	for (const key of payload.encryptionKeyring.all) {
		try {
			// Sequential on purpose: the active key comes first and almost always matches.
			// eslint-disable-next-line no-await-in-loop
			const { payload: claims, protectedHeader } = await jwtVerify(
				token,
				new TextEncoder().encode(key.legacyKey),
				{ algorithms: ["HS256"] },
			);

			return protectedHeader["authVersion"] === JWT_AUTH_VERSION
				? claims
				: undefined;
		} catch {
			// Try the next key.
		}
	}

	return undefined;
};

/** Seconds a timestamp may lie in the future, for clock skew between app servers. */
const CLOCK_TOLERANCE = 60;

const isWithin = (signedInAt: unknown, maxAge: number): boolean => {
	const time =
		signedInAt instanceof Date
			? signedInAt.getTime()
			: typeof signedInAt === "string"
				? Date.parse(signedInAt)
				: Number.NaN;
	const age = (Date.now() - time) / 1000;

	return age >= -CLOCK_TOLERANCE && age <= maxAge;
};

/**
 * Authenticates requests carrying a session token from the callback. Payload
 * extracts the token (cookie with its CSRF checks, or `Authorization` header);
 * this checks the signature, the collection and how long ago the user last
 * signed in through the provider.
 */
export const createStrategy = (args: {
	slug: string;
	maxSessionAge: number;
}): AuthStrategy => ({
	name: STRATEGY_NAME,
	authenticate: async ({ headers, isGraphQL, payload, req }) => {
		const token = extractJWT({ headers, payload });
		const claims = token ? await verifySessionToken(payload, token) : undefined;
		const id = claims?.["id"];

		if (
			claims?.["collection"] !== args.slug ||
			(typeof id !== "string" && typeof id !== "number")
		) {
			return { user: null };
		}

		const collection = payload.collections[args.slug];
		const user = await payload.findByID({
			collection: args.slug,
			id,
			depth: isGraphQL ? 0 : (collection?.config.auth.depth ?? 0),
			disableErrors: true,
			overrideAccess: true,
			...(req ? { req } : {}),
		});

		if (!user || !isWithin(user[SIGNED_IN_AT_FIELD], args.maxSessionAge)) {
			return { user: null };
		}

		return {
			user: { ...user, collection: args.slug, _strategy: STRATEGY_NAME },
		};
	},
});
