import { defineConfig } from "tsdown";
import swc from "unplugin-swc";

export default defineConfig({
	attw: { profile: "esm-only", level: "error" },
	publint: true,
	entry: ["src/index.ts", "src/config/index.ts", "src/lexical/index.tsx"],
	unbundle: true,
	format: ["esm"],
	clean: true,
	deps: { neverBundle: true },
	plugins: [swc.rolldown()],
});
