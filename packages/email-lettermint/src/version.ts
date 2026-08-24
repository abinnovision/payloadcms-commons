declare const __LETTERMINT_VERSION__: string | undefined;

/**
 * Package version injected at build time; sources under Vitest report "dev".
 */
const LETTERMINT_VERSION: string =
	typeof __LETTERMINT_VERSION__ === "string" ? __LETTERMINT_VERSION__ : "dev";

export { LETTERMINT_VERSION };
