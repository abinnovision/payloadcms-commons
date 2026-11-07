/**
 * Values shared by the endpoints and the login component. Kept free of
 * imports so the admin bundle reaches nothing else through it.
 */

/** `?oidc=` values the login page understands. */
export type OidcStatus = "denied" | "failed" | "signed-out";

/** Short-lived cookie set by the callback; the login page reads it to stop redirect loops. */
export const bounceCookieName = (cookiePrefix: string): string =>
	`${cookiePrefix}-oidc-bounce`;
