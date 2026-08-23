import { InvalidConfiguration } from "payload";
import { hasDraftsEnabled } from "payload/shared";

import { BUILTIN_TOOL_NAMES } from "./tools/names.js";
import { MCPX_VERSION } from "./version.js";

import type { McpxPluginOptions, McpxTool } from "./types.js";
import type { CollectionConfig, Config } from "payload";

const DEFAULT_API_KEYS_SLUG = "mcpx-api-keys";
const DEFAULT_ENDPOINT_PATH = "/mcpx";
const DEFAULT_MAX_LIMIT = 25;
const DEFAULT_MAX_DEPTH = 1;
const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/;

interface NormalizedCollection {
	slug: string;
	read: boolean;
	write: boolean;
	allowLiveWrites: boolean;
	hasDrafts: boolean;
	/** Name of the capability group on the key document. */
	fieldName: string;
}

interface NormalizedOptions {
	collections: NormalizedCollection[];
	userCollection: string;
	apiKeysSlug: string;
	endpointPath: string;
	limits: { maxLimit: number; maxDepth: number };
	tools: McpxTool[];
	auth: McpxPluginOptions["auth"];
	serverInfo: { name: string; version: string };
}

const fail = (message: string): never => {
	throw new InvalidConfiguration(`[payloadcms-mcpx] ${message}`);
};

/**
 * Lower camel case of a slug, the same transform the stock MCP plugin applies
 * to derive field names from collection slugs.
 */
const toCamelCase = (value: string): string =>
	value
		.replace(/[-_\s]+(.)?/g, (_, char: string | undefined) =>
			char ? char.toUpperCase() : "",
		)
		.replace(/^(.)/, (_, char: string) => char.toLowerCase());

/**
 * Refuses collections that must never be reachable through MCP, read included.
 * Auth collections carry credentials: `useAPIKey` stores a key that decrypts on
 * read, and email or lockout state is PII either way.
 */
const assertExposable = (
	collection: CollectionConfig,
	apiKeysSlug: string,
): void => {
	const { slug } = collection;

	if (slug === apiKeysSlug || slug.startsWith("payload-")) {
		fail(`Collection "${slug}" cannot be exposed.`);
	}

	if (collection.auth) {
		fail(
			`Auth collection "${slug}" cannot be exposed. Its documents carry credentials.`,
		);
	}
};

const assertWritable = (
	collection: CollectionConfig,
	options: {
		allowLiveWrites: boolean;
		hasDrafts: boolean;
	},
): void => {
	const { slug } = collection;

	if (collection.upload) {
		fail(`Upload collection "${slug}" cannot be exposed for write.`);
	}

	if (collection.timestamps === false) {
		fail(
			`Collection "${slug}" has timestamps disabled, which write tools need for concurrency checks.`,
		);
	}

	if (!options.hasDrafts && !options.allowLiveWrites) {
		fail(
			`Collection "${slug}" has no drafts. Enable versions.drafts or set allowLiveWrites.`,
		);
	}
};

const normalizeCollections = (
	config: Config,
	options: McpxPluginOptions,
	apiKeysSlug: string,
): NormalizedCollection[] => {
	const collections = config.collections ?? [];
	const fieldNames = new Set<string>();

	return Object.entries(options.collections).flatMap(
		([slug, raw]): NormalizedCollection[] => {
			if (raw === undefined) {
				return [];
			}

			const collection = collections.find(
				(candidate) => candidate.slug === slug,
			);

			if (!collection) {
				return fail(`Exposed collection "${slug}" does not exist.`);
			}

			assertExposable(collection, apiKeysSlug);

			const settings = raw === true ? {} : raw;
			const hasDrafts = hasDraftsEnabled(collection);
			const normalized: NormalizedCollection = {
				slug,
				read: settings.read ?? true,
				write: settings.write ?? false,
				allowLiveWrites: settings.allowLiveWrites ?? false,
				hasDrafts,
				fieldName: toCamelCase(slug),
			};

			if (normalized.write) {
				assertWritable(collection, normalized);
			}

			if (fieldNames.has(normalized.fieldName)) {
				fail(
					`Collection "${slug}" maps to capability field "${normalized.fieldName}", which another exposed collection already uses.`,
				);
			}

			fieldNames.add(normalized.fieldName);

			return [normalized];
		},
	);
};

const assertUserCollection = (config: Config, slug: string): void => {
	const collection = (config.collections ?? []).find(
		(candidate) => candidate.slug === slug,
	);

	if (!collection) {
		fail(`User collection "${slug}" does not exist.`);
	} else if (!collection.auth) {
		fail(`User collection "${slug}" is not an auth collection.`);
	}
};

const assertTools = (tools: McpxTool[]): void => {
	const names = new Set<string>();

	for (const tool of tools) {
		if (!TOOL_NAME_PATTERN.test(tool.name)) {
			fail(`Tool name "${tool.name}" must match ${String(TOOL_NAME_PATTERN)}.`);
		}

		if ((BUILTIN_TOOL_NAMES as readonly string[]).includes(tool.name)) {
			fail(`Tool name "${tool.name}" is reserved for a builtin tool.`);
		}

		if (names.has(tool.name)) {
			fail(`Tool name "${tool.name}" is used twice.`);
		}

		names.add(tool.name);
	}
};

const normalizeLimits = (
	limits: McpxPluginOptions["limits"],
): NormalizedOptions["limits"] => {
	const maxLimit = limits?.maxLimit ?? DEFAULT_MAX_LIMIT;
	const maxDepth = limits?.maxDepth ?? DEFAULT_MAX_DEPTH;

	if (!Number.isInteger(maxLimit) || maxLimit < 1) {
		fail("limits.maxLimit must be a positive integer.");
	}

	if (!Number.isInteger(maxDepth) || maxDepth < 0) {
		fail("limits.maxDepth must be a non-negative integer.");
	}

	return { maxLimit, maxDepth };
};

/**
 * Validates the plugin options against the incoming config and fills in
 * defaults. Every problem is an `InvalidConfiguration` so misconfiguration
 * fails at startup instead of at request time.
 */
const normalizeOptions = (
	config: Config,
	options: McpxPluginOptions,
): NormalizedOptions => {
	const apiKeysSlug = options.apiKeys?.slug ?? DEFAULT_API_KEYS_SLUG;
	const userCollection =
		options.userCollection ?? config.admin?.user ?? "users";

	if ((config.collections ?? []).some((c) => c.slug === apiKeysSlug)) {
		fail(`API key collection slug "${apiKeysSlug}" is already taken.`);
	}

	assertUserCollection(config, userCollection);

	const tools = options.tools ?? [];

	assertTools(tools);

	return {
		collections: normalizeCollections(config, options, apiKeysSlug),
		userCollection,
		apiKeysSlug,
		endpointPath: options.endpoint?.path ?? DEFAULT_ENDPOINT_PATH,
		limits: normalizeLimits(options.limits),
		tools,
		auth: options.auth,
		serverInfo: {
			name: options.serverInfo?.name ?? "payloadcms-mcpx",
			version: options.serverInfo?.version ?? MCPX_VERSION,
		},
	};
};

export { normalizeOptions, toCamelCase };
export type { NormalizedCollection, NormalizedOptions };
