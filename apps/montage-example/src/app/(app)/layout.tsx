import type React from "react";

const metadata = {
	title: "montage example",
	description:
		"Example Payload CMS app mounting @abinnovision/payloadcms-montage",
};

const Layout = ({ children }: { children: React.ReactNode }) => (
	<html lang="en">
		<body>{children}</body>
	</html>
);

export { metadata };
export default Layout;
