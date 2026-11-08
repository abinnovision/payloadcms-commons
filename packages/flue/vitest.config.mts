import { payloadV4Resolver } from "@internal/test-utils/payload-v4";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const exampleDir = fileURLToPath(
	new URL("../../apps/example-v4", import.meta.url),
);

const cachePath = fileURLToPath(
	new URL("../../node_modules/.vitest-cache-v4", import.meta.url),
);

export default defineProject({
	plugins: [payloadV4Resolver(exampleDir)],
	test: {
		name: "@abinnovision/payloadcms-flue#unit",
		include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
		environment: "node",
		fsModuleCachePath: cachePath,
	},
});
