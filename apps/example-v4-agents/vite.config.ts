import { flue } from "@flue/vite";
import { defineConfig, loadEnv } from "vite";

const REQUIRED = ["PAYLOAD_URL", "FLUE_SIDECAR_SECRET"];

export default defineConfig(({ command, mode }) => {
	// The dev server reads the same .env files and shell variables as the agents.
	if (command === "serve") {
		const env = loadEnv(mode, process.cwd(), "");
		const missing = REQUIRED.filter((name) => !env[name]);

		if (missing.length > 0) {
			throw new Error(
				`${missing.join(" and ")} must be set. Copy .env.example to .env and fill it in.`,
			);
		}
	}

	return { plugins: [flue()] };
});
