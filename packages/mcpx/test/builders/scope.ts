import { resolveCapabilities, slugsWith } from "../../src/capabilities.js";

import type { NormalizedOptions } from "../../src/options.js";
import type { McpxExposedEntity, McpxToolScope } from "../../src/types.js";
import type { PayloadRequest, SanitizedConfig } from "payload";

/** An exposed collection or global, readable and drafting unless overridden. */
export const entity = (
	slug: string,
	overrides: Partial<McpxExposedEntity> = {},
): McpxExposedEntity => ({
	slug,
	read: true,
	write: "draft",
	hasDrafts: true,
	hasVersions: overrides.hasDrafts ?? true,
	isUpload: false,
	fieldName: slug,
	...overrides,
});

/**
 * The scope the endpoint builds for a key: its checkboxes resolved against the
 * options, and the locales taken from `config` when it has any.
 */
export const scopeFor = (
	options: Partial<NormalizedOptions>,
	keyCapabilities: unknown,
	config?: SanitizedConfig,
): McpxToolScope => {
	const resolved = {
		collections: [],
		globals: [],
		tools: [],
		limits: { maxLimit: 25, maxDepth: 1 },
		...options,
	};
	const capabilities = resolveCapabilities(
		resolved as NormalizedOptions,
		keyCapabilities,
	);
	const localization = config?.localization;

	return {
		req: { payload: { config } } as unknown as PayloadRequest,
		capabilities,
		readable: slugsWith(capabilities.collections, "read"),
		writable: slugsWith(capabilities.collections, "write"),
		publishable: slugsWith(capabilities.collections, "publish"),
		readableGlobals: slugsWith(capabilities.globals, "read"),
		writableGlobals: slugsWith(capabilities.globals, "write"),
		publishableGlobals: slugsWith(capabilities.globals, "publish"),
		locales: localization ? localization.localeCodes : null,
		defaultLocale: localization ? localization.defaultLocale : null,
		limits: resolved.limits,
		exposure: { collections: resolved.collections, globals: resolved.globals },
	};
};
