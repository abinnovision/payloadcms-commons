"use client";

import { LogOutIcon, PopupList, useTranslation } from "@payloadcms/ui";

import type { OidcLogoutClientProps } from "../plugin.js";

/**
 * Payload's own logout entry in the user menu, with a full page navigation to
 * the plugin's logout endpoint instead of the admin's logout route. A client
 * side navigation would not follow the endpoint's redirect to the provider.
 */
export const OidcLogoutButton = ({
	logoutURL,
}: OidcLogoutClientProps): React.ReactElement => {
	const { t } = useTranslation();

	return (
		<PopupList.Button
			icon={<LogOutIcon />}
			onClick={() => {
				window.location.assign(logoutURL);
			}}
		>
			{t("authentication:logOut")}
		</PopupList.Button>
	);
};
