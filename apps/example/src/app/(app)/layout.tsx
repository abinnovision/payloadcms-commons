import { ViewfinderBridge } from "@abinnovision/payloadcms-viewfinder/client";

import { RefreshOnSave } from "./RefreshOnSave";

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
 * The `<html>` shell is not here. It needs the locale for its `lang`, and the
 * locale is a function of the path, which only the route below this sees — a
 * layout that hardcoded one served every German page as English.
 */
const Layout = ({ children }: { children: React.ReactNode }) => (
	<>
		{children}
		<RefreshOnSave serverURL={serverURL} />
		<ViewfinderBridge adminOrigin={new URL(serverURL).origin} />
	</>
);

export { metadata };
export default Layout;
