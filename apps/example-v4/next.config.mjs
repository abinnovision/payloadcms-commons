import { withPayload } from "@payloadcms/next/withPayload";

/*
 * The plugins are workspace symlinks, so their own `payload` and
 * `@payloadcms/ui` imports resolve from `packages/<name>/` to the v3 copy
 * hoisted to the repository root. These aliases resolve them from this app,
 * which has v4 installed in its own node_modules. The `payload` CLI scripts
 * and the tsconfig solve the same problem with `preserveSymlinks`.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
	turbopack: {
		resolveAlias: {
			payload: "payload",
			"payload/*": "payload/*",
			"@payloadcms/ui": "@payloadcms/ui",
			"@payloadcms/ui/*": "@payloadcms/ui/*",
		},
	},
};

export default withPayload(nextConfig);
