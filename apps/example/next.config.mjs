import { withPayload } from "@payloadcms/next/withPayload";

/** @type {import('next').NextConfig} */
const nextConfig = {
	/*
	 * Bundled by Turbopack, the Hatchet SDK cannot open the worker's listener
	 * ("Cannot find module as expression is too dynamic"), so the worker in
	 * `src/instrumentation.ts` never receives a run. Node loads it instead.
	 */
	serverExternalPackages: ["@hatchet-dev/typescript-sdk"],
};

export default withPayload(nextConfig);
