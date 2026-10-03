import { InvalidConfiguration } from "payload";
import { hasDraftsEnabled, hasLocalizeStatusEnabled } from "payload/shared";

import { BUILTIN_TOOL_NAMES } from "./builtin-tool-names.js";
import { isPlainObject } from "./guards.js";
import { MCPX_VERSION } from "./version.js";

import type {
	McpxAnyTool,
	McpxExposedEntity,
	McpxPluginOptions,
	McpxWriteMode,
} from "./types.js";
import type { CollectionConfig, Config, GlobalConfig } from "payload";

const DEFAULT_API_KEYS_SLUG = "mcpx-api-keys";
const DEFAULT_ENDPOINT_PATH = "/mcpx";
const DEFAULT_MAX_LIMIT = 25;
const DEFAULT_MAX_DEPTH = 1;
const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * The plugin options after validation and defaulting, the only shape the rest
 * of the plugin reads. Shorthands from {@link McpxPluginOptions} are expanded
 * and slugs are checked against the config, so nothing downstream handles a
 * missing collection or an implicit default.
 */
export interface NormalizedOptions {
	collections: McpxExposedEntity[];
	globals: McpxExposedEntity[];
	userCollection: string;
	apiKeysSlug: string;
	endpointPath: string;
	/** Whether the key form gets the "Connect a client" tab. */
	setupGuide: boolean;
	limits: { maxLimit: number; maxDepth: number };
	tools: McpxAnyTool[];
	auth: McpxPluginOptions["auth"];
	serverInfo: { name: string; version: string };
}

const fail = (message: string): never => {
	throw new InvalidConfiguration(`[payloadcms-mcpx] ${message}`);
};

/** The same transform the stock MCP plugin uses to derive field names. */
export const toCamelCase = (value: string): string =>
	value
		.replace(/[-_\s]+(.)?/g, (_, char: string | undefined) =>
			char ? char.toUpperCase() : "",
		)
		.replace(/^(.)/, (_, char: string) => char.toLowerCase());

/*
 * Auth collections carry credentials: `useAPIKey` stores a key that decrypts on
 * read, and email or lockout state is PII either way. Refused for read too.
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

const OPTION_NAMES = ["read", "write", "publish"] as const;

const REMOVED_WRITE_MODES: Record<string, string> = {
	draft: "Use { publish: false } instead.",
	live: "Writes are on by default, so remove it.",
};

// Checked at runtime too: a truthy string would otherwise count as opted in.
const readFlag = (
	kind: string,
	slug: string,
	name: string,
	value: unknown,
): boolean | undefined => {
	if (value === undefined || typeof value === "boolean") {
		return value;
	}

	const moved =
		name === "write" && typeof value === "string"
			? REMOVED_WRITE_MODES[value]
			: undefined;

	return fail(
		`${kind} "${slug}" has ${name}: ${JSON.stringify(value)}. ${moved ?? "Use true or false."}`,
	);
};

/*
 * `localizeStatus` makes `_status` a localized field: Payload's
 * `publishAllLocales` default flips to false and `_status` becomes a
 * locale-keyed object. A publish would cover one locale while reporting
 * success, and the tool responses model `_status` as a string. The combination
 * is refused.
 */
const assertWritable = (
	kind: string,
	config: CollectionConfig | GlobalConfig,
	write: McpxWriteMode,
): void => {
	if (write === "live" && hasLocalizeStatusEnabled(config)) {
		fail(
			`${kind} "${config.slug}" has versions.drafts.localizeStatus enabled, which live writes do not support yet. Set publish: false or write: false.`,
		);
	}
};

/*
 * The config only takes capabilities away: read, write and publish default to
 * everything the entity supports, and a publish that is defaulted but
 * unsupported is derived off rather than refused. Version history follows read
 * where the entity keeps Payload versions. The entity value is checked at
 * runtime: only `true` or an object of the three options exposes it, so a typo
 * or a falsy value never widens access.
 */
const normalizeCapabilities = (
	kind: string,
	config: CollectionConfig | GlobalConfig,
	raw: unknown,
): Pick<McpxExposedEntity, "hasDrafts" | "hasVersions" | "read" | "write"> => {
	const { slug } = config;

	if (raw === false) {
		fail(
			`${kind} "${slug}" is set to false. Remove the entry to hide the ${kind.toLowerCase()}.`,
		);
	}

	if (raw !== true && !isPlainObject(raw)) {
		fail(
			`${kind} "${slug}" has ${JSON.stringify(raw)}. Use true or an object of ${OPTION_NAMES.join(", ")}.`,
		);
	}

	const settings: Record<string, unknown> = isPlainObject(raw) ? raw : {};
	const unknownKey = Object.keys(settings).find(
		(key) => !(OPTION_NAMES as readonly string[]).includes(key),
	);

	if (unknownKey !== undefined) {
		fail(
			`${kind} "${slug}" has the unknown option "${unknownKey}". The options are ${OPTION_NAMES.join(", ")}.`,
		);
	}

	const flag = (name: (typeof OPTION_NAMES)[number]): boolean | undefined =>
		readFlag(kind, slug, name, settings[name]);
	const read = flag("read") ?? true;
	const write = flag("write") ?? true;
	const publish = flag("publish");
	const hasDrafts = hasDraftsEnabled(config);

	if (publish === false && write && !hasDrafts) {
		fail(
			`${kind} "${slug}" has no drafts, so every write goes live. Set write: false or remove publish: false.`,
		);
	}

	if (publish === true && !hasDrafts) {
		fail(
			`${kind} "${slug}" has no drafts, so there is nothing to publish. Enable versions.drafts or remove publish: true.`,
		);
	}

	if (publish === true && !write) {
		fail(
			`${kind} "${slug}" has publish: true but write: false. Publishing follows write.`,
		);
	}

	return {
		read,
		/*
		 * Without drafts a write changes live content, so it maps to "live" too.
		 */
		write: write ? (publish === false ? "draft" : "live") : false,
		hasDrafts,
		hasVersions: read && Boolean(config.versions),
	};
};

// Globals cannot be auth or upload, so only the reserved namespace is left.
const assertGlobalExposable = (global: GlobalConfig): void => {
	if (global.slug.startsWith("payload-")) {
		fail(`Global "${global.slug}" cannot be exposed.`);
	}
};

const normalizeCollections = (
	config: Config,
	options: McpxPluginOptions,
	apiKeysSlug: string,
): McpxExposedEntity[] => {
	const collections = config.collections ?? [];
	const fieldNames = new Set<string>();

	return Object.entries(options.collections).flatMap(
		([slug, raw]): McpxExposedEntity[] => {
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

			const normalized: McpxExposedEntity = {
				slug,
				...normalizeCapabilities("Collection", collection, raw),
				isUpload: Boolean(collection.upload),
				fieldName: toCamelCase(slug),
			};

			if (normalized.write !== false) {
				if (collection.timestamps === false) {
					fail(
						`Collection "${slug}" has timestamps disabled, which write tools need for concurrency checks.`,
					);
				}

				assertWritable("Collection", collection, normalized.write);
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

const normalizeGlobals = (
	config: Config,
	options: McpxPluginOptions,
): McpxExposedEntity[] => {
	const globals = config.globals ?? [];
	/*
	 * Scoped to globals on purpose: a global and a collection may share a
	 * camelCase name because they land in separate capability groups.
	 */
	const fieldNames = new Set<string>();

	return Object.entries(options.globals ?? {}).flatMap(
		([slug, raw]): McpxExposedEntity[] => {
			if (raw === undefined) {
				return [];
			}

			const global = globals.find((candidate) => candidate.slug === slug);

			if (!global) {
				return fail(`Exposed global "${slug}" does not exist.`);
			}

			assertGlobalExposable(global);

			const normalized: McpxExposedEntity = {
				slug,
				...normalizeCapabilities("Global", global, raw),
				isUpload: false,
				fieldName: toCamelCase(slug),
			};

			/*
			 * `GlobalConfig` has no `timestamps` option and `sanitizeGlobal` always
			 * appends `createdAt`/`updatedAt`, so the concurrency check a collection
			 * is held to is always available here.
			 */
			if (normalized.write !== false) {
				assertWritable("Global", global, normalized.write);
			}

			if (fieldNames.has(normalized.fieldName)) {
				fail(
					`Global "${slug}" maps to capability field "${normalized.fieldName}", which another exposed global already uses.`,
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

const assertTools = (tools: McpxAnyTool[]): void => {
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

/** Every problem is an `InvalidConfiguration`, so it fails at startup. */
export const normalizeOptions = (
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
		globals: normalizeGlobals(config, options),
		userCollection,
		apiKeysSlug,
		endpointPath: options.endpoint?.path ?? DEFAULT_ENDPOINT_PATH,
		setupGuide: options.apiKeys?.setupGuide ?? true,
		limits: normalizeLimits(options.limits),
		tools,
		auth: options.auth,
		serverInfo: {
			name: options.serverInfo?.name ?? "payloadcms-mcpx",
			version: options.serverInfo?.version ?? MCPX_VERSION,
		},
	};
};
