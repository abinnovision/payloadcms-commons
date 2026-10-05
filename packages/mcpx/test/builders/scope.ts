import { resolveCapabilities } from "../../src/capabilities.js";
import { buildScope } from "../../src/endpoint/handler.js";

import type { NormalizedOptions } from "../../src/options.js";
import type { McpxExposedEntity, McpxToolScope } from "../../src/types.js";
import type { PayloadRequest, SanitizedConfig } from "payload";

/**
 * An exposed collection or global, readable and drafting unless overridden.
 */
export const entity = (
	slug: string,
	overrides: Partial<McpxExposedEntity> = {},
): McpxExposedEntity => ({
	slug,
	read: true,
	write: "draft",
	hasDrafts: true,
	hasVersions: overrides.hasDrafts ?? true,
	delete: false,
	deleteUnattended: false,
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
	const normalized = resolved as NormalizedOptions;
	const req = {
		payload: {
			config: config ?? {},
			collections: Object.fromEntries(
				(config?.collections ?? []).map((entry) => [
					entry.slug,
					{ config: entry },
				]),
			),
		},
	} as unknown as PayloadRequest;

	return buildScope(
		req,
		normalized,
		resolveCapabilities(normalized, keyCapabilities),
	);
};
