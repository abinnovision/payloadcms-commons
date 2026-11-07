import { Banner, Button } from "@payloadcms/ui";

import { bounceCookieName } from "../status.js";
import { OidcAutoRedirect } from "./auto-redirect.js";

import type { OidcLoginServerProps } from "../plugin.js";
import type { OidcStatus } from "../status.js";
import type { ServerProps } from "payload";

const MESSAGES = {
	"signed-out": "authentication:loggedOutSuccessfully",
	denied: "error:notAllowedToAccessPage",
	failed: "error:unknown",
} as const satisfies Record<OidcStatus, string>;

const readParam = (
	searchParams: ServerProps["searchParams"],
	key: string,
): string | undefined => {
	const value = searchParams?.[key];

	return typeof value === "string" ? value : undefined;
};

const readStatus = (value: string | undefined): OidcStatus | undefined =>
	value !== undefined && Object.hasOwn(MESSAGES, value)
		? (value as OidcStatus)
		: undefined;

/**
 * Rendered before the (disabled) login form. Forwards to the provider unless
 * the visitor just came back from it: after signing out, after a refused or
 * failed sign-in, or when the callback's session did not take. Those cases
 * show a message and a button instead, so the page never loops.
 */
export const OidcLogin = async ({
	autoRedirect,
	i18n,
	loginURL,
	payload,
	searchParams,
	server,
}: OidcLoginServerProps & ServerProps): Promise<React.ReactElement> => {
	const redirect = readParam(searchParams, "redirect");
	const href = redirect
		? `${loginURL}?redirect=${encodeURIComponent(redirect)}`
		: loginURL;
	const cookies = await server.getCookies();
	const bounced = Boolean(
		cookies.get(bounceCookieName(payload.config.cookiePrefix)),
	);
	const status =
		readStatus(readParam(searchParams, "oidc")) ??
		(bounced ? "failed" : undefined);

	/*
	 * Payload's own login form markup and classes, so the page looks unchanged
	 * apart from the missing email and password fields.
	 */
	return (
		<div className="login__form">
			{autoRedirect && status === undefined ? (
				<OidcAutoRedirect href={href} />
			) : null}
			{status ? (
				<Banner type={status === "signed-out" ? "success" : "danger"}>
					{i18n.t(MESSAGES[status])}
				</Banner>
			) : null}
			<div className="login__form__actions">
				<div className="form-submit">
					<Button el="anchor" url={href}>
						{i18n.t("authentication:login")}
					</Button>
				</div>
			</div>
		</div>
	);
};
