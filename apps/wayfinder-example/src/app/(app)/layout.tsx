import type { ReactNode } from "react";

const Layout = ({ children }: { children: ReactNode }) => (
	<html lang="en">
		<body style={{ margin: 0 }}>{children}</body>
	</html>
);

export default Layout;
