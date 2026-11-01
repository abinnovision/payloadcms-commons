import { headers } from "next/headers";

import { splitLocale } from "../../locales";
import { PATHNAME_HEADER } from "../../proxy";

import type React from "react";

const metadata = {
	title: "payloadcms-commons example (Payload v4)",
	description:
		"Example Payload CMS v4 app mounting the payloadcms-commons packages",
};

/**
 * The document shell lives here because this is the root layout of the site,
 * and Next renders it for the not-found path too, where no page runs. `lang`
 * still has to be right for whichever locale the path names, so the path
 * arrives on a header the proxy sets. A layout is not given the params of the
 * segments below it, and this app's locale is an optional prefix inside a
 * catch-all rather than a segment of its own.
 */
const Layout = async ({ children }: { children: React.ReactNode }) => {
	const pathname = (await headers()).get(PATHNAME_HEADER) ?? "/";
	const { locale } = splitLocale(pathname.split("/").filter(Boolean));

	return (
		<html lang={locale}>
			<body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
				{children}
			</body>
		</html>
	);
};

export { metadata };
export default Layout;
