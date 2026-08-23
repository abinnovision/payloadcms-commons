import config from "@payload-config";
import "@payloadcms/next/css";
import { handleServerFunctions, RootLayout } from "@payloadcms/next/layouts";

import { importMap } from "./admin/importMap.js";
import "./custom.scss";

import type { ServerFunctionClient } from "payload";
import type React from "react";

const serverFunction: ServerFunctionClient = async function (args) {
	"use server";
	return await handleServerFunctions({ ...args, config, importMap });
};

const Layout = ({ children }: { children: React.ReactNode }) => (
	<RootLayout
		config={config}
		importMap={importMap}
		serverFunction={serverFunction}
	>
		{children}
	</RootLayout>
);

export default Layout;
