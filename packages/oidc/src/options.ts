import type { OidcSignInContext } from "./context.js";
import type { OidcRolesOptions } from "./roles.js";

export interface OidcPluginOptions {
	/** The provider's issuer URL; its discovery document is read from there. */
	issuer: string;

	clientId: string;

	clientSecret: string;

	/** The auth collection to take over. Defaults to `admin.user`, then `users`. */
	collection?: string | undefined;

	/** Requested scopes. Defaults to `openid email profile`. */
	scopes?: readonly string[] | undefined;

	/**
	 * Public origin of the app, used for the redirect URIs registered at the
	 * provider. Defaults to the config's `serverURL`.
	 */
	serverURL?: string | undefined;

	/**
	 * Decides whether this person may sign in at all, e.g. on a group claim.
	 * Runs before anything is written. Defaults to allowing everyone the
	 * provider authenticates.
	 */
	allow?:
		((context: OidcSignInContext) => boolean | Promise<boolean>) | undefined;

	/**
	 * Extra data written to the user on every sign-in, merged over `email`
	 * and `name` from the claims.
	 */
	mapUser?:
		| ((
				context: OidcSignInContext,
		  ) => Record<string, unknown> | Promise<Record<string, unknown>>)
		| undefined;

	/** Maps claims to the user's `roles` field on every sign-in. */
	roles?: OidcRolesOptions | undefined;

	/**
	 * Seconds a sign-in lasts before the provider is asked again, however
	 * often the admin refreshes its token. Defaults to 8 hours.
	 */
	maxSessionAge?: number | undefined;

	/**
	 * Send visitors of the admin login page straight to the provider.
	 * Defaults to true; false shows a sign-in button instead.
	 */
	autoRedirect?: boolean | undefined;

	/**
	 * Allows plain HTTP to the provider. For a local development provider
	 * only.
	 */
	allowInsecureRequests?: boolean | undefined;
}

export const DEFAULT_SCOPES = ["openid", "email", "profile"] as const;

export const DEFAULT_MAX_SESSION_AGE = 8 * 60 * 60;

/**
 * Rejects options that cannot work, where the config file is evaluated rather
 * than on the first sign-in.
 */
export const validateOptions = (options: OidcPluginOptions): void => {
	for (const key of ["issuer", "clientId", "clientSecret"] as const) {
		if (typeof options[key] !== "string" || options[key].length === 0) {
			throw new Error(`[payloadcms-oidc] \`${key}\` is required.`);
		}
	}

	if (!URL.canParse(options.issuer)) {
		throw new Error("[payloadcms-oidc] `issuer` must be an absolute URL.");
	}

	if (
		options.maxSessionAge !== undefined &&
		!(Number.isFinite(options.maxSessionAge) && options.maxSessionAge > 0)
	) {
		throw new Error(
			"[payloadcms-oidc] `maxSessionAge` must be a positive number of seconds.",
		);
	}
};
