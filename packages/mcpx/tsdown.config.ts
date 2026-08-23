import { readFileSync } from "node:fs";

import { defineConfig } from "tsdown";
import swc from "unplugin-swc";

const { version } = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
	attw: { profile: "esm-only", level: "error" },
	publint: true,
	entry: ["src/index.ts"],
	unbundle: true,
	format: ["esm"],
	clean: true,
	deps: { skipNodeModulesBundle: true },
	define: { __MCPX_VERSION__: JSON.stringify(version) },
	plugins: [swc.rolldown()],
});
