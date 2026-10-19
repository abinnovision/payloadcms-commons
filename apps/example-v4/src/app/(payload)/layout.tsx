import config from "@payload-config";
import "@payloadcms/next/css";
import {
	generatePayloadViewport,
	handleServerFunctions,
	RootLayout,
} from "@payloadcms/next/layouts";

import { importMap } from "./admin/importMap";
import "./custom.css";

import type { ServerFunctionClient } from "payload";
import type React from "react";

const generateViewport = generatePayloadViewport;

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

export { generateViewport };
export default Layout;
