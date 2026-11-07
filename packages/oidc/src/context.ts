import type { PayloadRequest } from "payload";

/**
 * Everything known about the person signing in, handed to `allow`, `mapUser`
 * and the role mapping.
 */
export interface OidcSignInContext {
	/** The validated ID token claims. */
	claims: Record<string, unknown> & { sub: string };

	/** The userinfo response, when the provider has a userinfo endpoint. */
	userinfo: Record<string, unknown> | undefined;

	/**
	 * The access token payload, when the access token is a JWT. Decoded, not
	 * verified: it comes straight from the token endpoint over TLS.
	 */
	accessToken: Record<string, unknown> | undefined;

	req: PayloadRequest;
}
