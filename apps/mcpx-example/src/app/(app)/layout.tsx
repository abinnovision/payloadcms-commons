import type React from "react";

const metadata = {
	title: "mcpx example",
	description: "Example Payload CMS app mounting @abinnovision/payloadcms-mcpx",
};

const Layout = ({ children }: { children: React.ReactNode }) => (
	<html lang="en">
		<body>{children}</body>
	</html>
);

export { metadata };
export default Layout;
