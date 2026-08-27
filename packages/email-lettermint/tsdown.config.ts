import { defineConfig } from "tsdown";
import swc from "unplugin-swc";

export default defineConfig({
	attw: { profile: "esm-only", level: "error" },
	publint: true,
	entry: ["src/index.ts"],
	unbundle: true,
	format: ["esm"],
	clean: true,
	deps: { skipNodeModulesBundle: true },
	plugins: [swc.rolldown()],
});
