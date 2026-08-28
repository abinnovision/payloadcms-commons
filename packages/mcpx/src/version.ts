declare const __MCPX_VERSION__: string | undefined;

/**
 * Package version injected at build time; sources under Vitest report "dev".
 */
export const MCPX_VERSION =
	typeof __MCPX_VERSION__ === "string" ? __MCPX_VERSION__ : "dev";
