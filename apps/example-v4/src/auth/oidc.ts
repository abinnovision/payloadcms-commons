import { oidcPlugin } from "@abinnovision/payloadcms-oidc";

import type { Plugin } from "payload";

/**
 * Single sign-on, on only when `OIDC_ISSUER` is set, so the example keeps its
 * password login by default. `yarn idp` starts a local provider to point it at.
 */
export const oidc = (): Plugin[] => {
	const issuer = process.env["OIDC_ISSUER"];

	if (!issuer) {
		return [];
	}

	return [
		oidcPlugin({
			issuer,
			clientId: process.env["OIDC_CLIENT_ID"] ?? "payload",
			clientSecret: process.env["OIDC_CLIENT_SECRET"] ?? "",
			allowInsecureRequests: issuer.startsWith("http://localhost"),
			roles: {
				claim: "groups",
				map: { "cms-admins": ["admin"], "cms-editors": ["editor"] },
			},
		}),
	];
};
