import { defineConfig } from "tsdown";
import swc from "unplugin-swc";

export default defineConfig({
	attw: { profile: "esm-only", level: "error" },
	publint: true,
	entry: [
		"src/index.ts",
		"src/client/index.ts",
		"src/config/index.ts",
		"src/admin/index.ts",
	],
	unbundle: true,
	format: ["esm"],
	clean: true,
	deps: { neverBundle: true },
	plugins: [swc.rolldown()],
});
