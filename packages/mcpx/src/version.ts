declare const __MCPX_VERSION__: string | undefined;

/**
 * Package version injected at build time; sources under Vitest report "dev".
 */
const MCPX_VERSION: string =
	typeof __MCPX_VERSION__ === "string" ? __MCPX_VERSION__ : "dev";

export { MCPX_VERSION };
