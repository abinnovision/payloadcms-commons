import { defineConfig } from "tsdown";
import swc from "unplugin-swc";

export default defineConfig({
	attw: { profile: "esm-only", level: "error" },
	publint: true,
	entry: ["src/index.ts", "src/admin/index.ts", "src/agent/index.ts"],
	unbundle: true,
	format: ["esm"],
	clean: false,
	deps: { neverBundle: true },
	plugins: [swc.rolldown()],
});
