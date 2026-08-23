import { configFiles } from "@abinnovision/eslint-config-base";
import { defineConfig } from "eslint/config";

export default defineConfig([
	{ files: ["*.{c,m,}{t,j}s"], extends: [configFiles] },
]);
