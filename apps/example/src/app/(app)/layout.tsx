import { ViewfinderBridge } from "@abinnovision/payloadcms-viewfinder/client";
import { headers } from "next/headers";

import { RefreshOnSave } from "./RefreshOnSave";
import { splitLocale } from "../../locales";
import { PATHNAME_HEADER } from "../../proxy";

import type React from "react";

const metadata = {
	title: "payloadcms-commons example",
	description:
		"Example Payload CMS app mounting the payloadcms-commons packages",
};

const serverURL = process.env["PAYLOAD_URL"] ?? "http://localhost:3000";

/**
 * Both preview components are mounted unconditionally. Each is inert unless
 * the page is inside the admin's preview iframe, so there is no second tree
 * to keep in step with the real one.
 *
 * The document shell lives here because this is the root layout of the site,
 * and Next renders it for the not-found path too, where no page runs. `lang`
 * still has to be right for whichever locale the path names, so the path
 * arrives on a header the middleware sets — a layout is not given the params
 * of the segments below it, and this app's locale is an optional prefix inside
 * a catch-all rather than a segment of its own.
 */
const Layout = async ({ children }: { children: React.ReactNode }) => {
	const pathname = (await headers()).get(PATHNAME_HEADER) ?? "/";
	const { locale } = splitLocale(pathname.split("/").filter(Boolean));

	return (
		<html lang={locale}>
			<body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
				{children}
				<RefreshOnSave serverURL={serverURL} />
				<ViewfinderBridge adminOrigin={new URL(serverURL).origin} />
			</body>
		</html>
	);
};

export { metadata };
export default Layout;
