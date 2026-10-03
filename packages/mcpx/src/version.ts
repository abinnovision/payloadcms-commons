declare const __MCPX_VERSION__: string | undefined;

/**
 * Package version injected at build time; sources under Vitest report "dev".
 */
export const MCPX_VERSION =
	typeof __MCPX_VERSION__ === "string" ? __MCPX_VERSION__ : "dev";

export const MCPX_REPOSITORY_URL =
	"https://github.com/abinnovision/payloadcms-commons/tree/main/packages/mcpx";

export const MCPX_ISSUES_URL =
	"https://github.com/abinnovision/payloadcms-commons/issues";
