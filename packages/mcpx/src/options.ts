import { InvalidConfiguration } from "payload";
import { hasDraftsEnabled, hasLocalizeStatusEnabled } from "payload/shared";

import { isPlainObject } from "./guards.js";
import { MCPX_VERSION } from "./version.js";

import type {
	McpxAnyTool,
	McpxExposedEntity,
	McpxPluginOptions,
} from "./types.js";
import type {
	CollectionConfig,
	Config,
	GlobalConfig,
	SanitizedConfig,
} from "payload";

const DEFAULT_API_KEYS_SLUG = "mcpx-api-keys";
const DEFAULT_ENDPOINT_PATH = "/mcpx";
const DEFAULT_FOLDERS_SLUG = "payload-folders";
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
	/**
	 * Whether the key form gets the "Connect a client" button and drawer.
	 */
	setupGuide: boolean;
	limits: { maxLimit: number; maxDepth: number };
	tools: McpxAnyTool[];
	/**
	 * Whether any collection exposes `delete`, whose calls need approval. Adds
	 * the confirmations panel and endpoints.
	 */
	confirmations: boolean;
	auth: McpxPluginOptions["auth"];
	serverInfo: { name: string; version: string };
	diagnostics: boolean;
}

type EntityKind = "Collection" | "Global";

const fail = (message: string): never => {
	throw new InvalidConfiguration(`[payloadcms-mcpx] ${message}`);
};

/**
 * The same transform the stock MCP plugin uses to derive field names.
 */
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
	kind: EntityKind,
	config: CollectionConfig | GlobalConfig,
	apiKeysSlug: string,
	foldersSlug?: string,
): void => {
	const { slug } = config;

	if (
		(slug.startsWith("payload-") && slug !== foldersSlug) ||
		(kind === "Collection" && slug === apiKeysSlug)
	) {
		fail(`${kind} "${slug}" cannot be exposed.`);
	}

	if ("auth" in config && config.auth) {
		fail(
			`Auth collection "${slug}" cannot be exposed. Its documents carry credentials.`,
		);
	}
};

const OPTION_NAMES = ["read", "write", "publish", "delete"] as const;

// Globals cannot be deleted.
const GLOBAL_OPTION_NAMES = ["read", "write", "publish"] as const;

const REMOVED_WRITE_MODES: Record<string, string> = {
	draft: "Use { publish: false } instead.",
	live: "Writes are on by default, so remove it.",
};

// Checked at runtime too: a truthy string would otherwise count as opted in.
const readFlag = (
	kind: EntityKind,
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
 * `experimental.localizeStatus` makes `_status` a localized field: Payload's
 * `publishAllLocales` default flips to false and `_status` becomes a
 * locale-keyed object. A publish would cover one locale while reporting
 * success, and the tool responses model `_status` as a string. The combination
 * is refused. Without the experimental flag, `versions.drafts.localizeStatus`
 * has no effect.
 */
const assertWritable = (
	kind: EntityKind,
	root: Config,
	config: CollectionConfig | GlobalConfig,
	publish: boolean,
): void => {
	// Payload 4 has no `experimental` option.
	const { experimental } = root as {
		experimental?: { localizeStatus?: boolean };
	};

	if (
		publish &&
		experimental?.localizeStatus === true &&
		hasLocalizeStatusEnabled(config)
	) {
		fail(
			`${kind} "${config.slug}" has versions.drafts.localizeStatus enabled, which live writes do not support yet. Set publish: false or write: false.`,
		);
	}
};

/*
 * `"unattended"` deletes without approval, so it is held to collections whose
 * deletes only move to trash.
 */
const normalizeDelete = (
	kind: EntityKind,
	config: CollectionConfig | GlobalConfig,
	value: unknown,
): Pick<McpxExposedEntity, "delete" | "deleteUnattended"> => {
	if (value !== "unattended") {
		return {
			delete: readFlag(kind, config.slug, "delete", value) ?? false,
			deleteUnattended: false,
		};
	}

	if (!("trash" in config) || !config.trash) {
		fail(
			`${kind} "${config.slug}" has delete: "unattended" but no trash, so a delete without approval would be permanent. Enable trash or set delete: true.`,
		);
	}

	return { delete: true, deleteUnattended: true };
};

/*
 * The config only takes capabilities away: read, write and publish default to
 * everything the entity supports, and a publish that is defaulted but
 * unsupported is derived off rather than refused. Delete is the exception and
 * defaults to off. Version history follows read where the entity keeps
 * Payload versions. The entity value is checked at runtime: only `true` or an
 * object of the known options exposes it, so a typo or a falsy value never
 * widens access.
 */
const normalizeCapabilities = (
	kind: EntityKind,
	config: CollectionConfig | GlobalConfig,
	raw: unknown,
): Pick<
	McpxExposedEntity,
	| "delete"
	| "deleteUnattended"
	| "hasDrafts"
	| "hasVersions"
	| "liveWrite"
	| "publish"
	| "read"
	| "write"
> => {
	const { slug } = config;
	const names: readonly string[] =
		kind === "Global" ? GLOBAL_OPTION_NAMES : OPTION_NAMES;

	if (raw === false) {
		fail(
			`${kind} "${slug}" is set to false. Remove the entry to hide the ${kind.toLowerCase()}.`,
		);
	}

	if (raw !== true && !isPlainObject(raw)) {
		fail(
			`${kind} "${slug}" has ${JSON.stringify(raw)}. Use true or an object of ${names.join(", ")}.`,
		);
	}

	const settings: Record<string, unknown> = isPlainObject(raw) ? raw : {};
	const unknownKey = Object.keys(settings).find((key) => !names.includes(key));

	if (unknownKey !== undefined) {
		fail(
			`${kind} "${slug}" has the unknown option "${unknownKey}". The options are ${names.join(", ")}.`,
		);
	}

	const flag = (name: (typeof OPTION_NAMES)[number]): boolean | undefined =>
		readFlag(kind, slug, name, settings[name]);
	const read = flag("read") ?? true;
	// Writing needs reading, so a write that is defaulted follows read.
	const write = flag("write") ?? read;
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

	if (!read && (flag("write") === true || publish === true)) {
		fail(
			`${kind} "${slug}" has read: false but write or publish on. Writing and publishing need read.`,
		);
	}

	if (publish === true && !write) {
		fail(
			`${kind} "${slug}" has publish: true but write: false. Publishing follows write.`,
		);
	}

	const deleting = normalizeDelete(kind, config, settings["delete"]);

	if (!read && deleting.delete) {
		fail(
			`${kind} "${slug}" has read: false but delete on. Deleting needs read.`,
		);
	}

	return {
		read,
		write,
		// Without drafts there is nothing to publish and every write goes live.
		publish: write && publish !== false && hasDrafts,
		liveWrite: write && !hasDrafts,
		hasDrafts,
		hasVersions: read && Boolean(config.versions),
		...deleting,
	};
};

type ConfigBySlug = Map<string, CollectionConfig | GlobalConfig>;

const bySlug = (configs: (CollectionConfig | GlobalConfig)[]): ConfigBySlug =>
	new Map(configs.map((config) => [config.slug, config]));

// Payload 4 has no root `folders` option.
const foldersSlugOf = (config: Config): string | undefined => {
	const { folders } = config as { folders?: false | { slug?: string } };

	return folders === false
		? undefined
		: (folders?.slug ?? DEFAULT_FOLDERS_SLUG);
};

const normalizeEntities = (
	kind: EntityKind,
	root: Config,
	configs: ConfigBySlug,
	entries: Record<string, unknown>,
	apiKeysSlug: string,
	foldersSlug?: string,
): McpxExposedEntity[] => {
	// A global and a collection may share a camelCase name: separate capability groups.
	const fieldNames = new Set<string>();

	return Object.entries(entries).flatMap(([slug, raw]): McpxExposedEntity[] => {
		if (raw === undefined) {
			return [];
		}

		/*
		 * Payload adds its internal collections after this plugin runs. The folder
		 * collection is assumed bare and checked in `reconcileOptions`.
		 */
		const config =
			configs.get(slug) ??
			(slug === foldersSlug ? { slug, fields: [] } : undefined);

		if (!config) {
			return fail(
				slug.startsWith("payload-")
					? `${kind} "${slug}" is internal to Payload and cannot be exposed.`
					: `Exposed ${kind.toLowerCase()} "${slug}" does not exist.`,
			);
		}

		assertExposable(kind, config, apiKeysSlug, foldersSlug);

		const normalized: McpxExposedEntity = {
			slug,
			...normalizeCapabilities(kind, config, raw),
			isUpload: "upload" in config && Boolean(config.upload),
			fieldName: toCamelCase(slug),
		};

		if (slug === foldersSlug && normalized.delete) {
			fail(
				`Collection "${slug}" holds folders, whose deletes also delete their subfolders with full access. Remove delete.`,
			);
		}

		// Globals have no `timestamps` option and always get `updatedAt`.
		if (normalized.write) {
			// Only an explicit `false` disables timestamps; `undefined` keeps the default.
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
			if ("timestamps" in config && config.timestamps === false) {
				fail(
					`Collection "${slug}" has timestamps disabled, which write tools need for concurrency checks.`,
				);
			}

			assertWritable(kind, root, config, normalized.publish);
		}

		if (fieldNames.has(normalized.fieldName)) {
			fail(
				`${kind} "${slug}" maps to capability field "${normalized.fieldName}", which another exposed ${kind.toLowerCase()} already uses.`,
			);
		}

		fieldNames.add(normalized.fieldName);

		return [normalized];
	});
};

/**
 * Checks the sanitized config against what {@link normalizeOptions} read from
 * the raw one. Updates the entities in place, since the endpoint handlers hold
 * them.
 */
export const reconcileOptions = (
	raw: Config,
	config: SanitizedConfig,
	options: NormalizedOptions,
): void => {
	const rawSlugs = new Set((raw.collections ?? []).map(({ slug }) => slug));

	for (const entity of options.collections) {
		const { slug } = entity;
		const collection = config.collections.find(
			(candidate) => candidate.slug === slug,
		);

		// Only the folder collection is absent from the raw config.
		if (!rawSlugs.has(slug)) {
			if (!collection) {
				fail(
					`Folder collection "${slug}" does not exist. Payload 3 adds it only where a collection has folders: true; on Payload 4, expose the collection with folders: true instead.`,
				);
			} else if (
				[
					collection.auth,
					collection.trash,
					collection.upload,
					collection.versions,
				].some(Boolean)
			) {
				fail(
					`Folder collection "${slug}" has auth, trash, upload or versions, which mcpx does not support. Remove it from collections.`,
				);
			}
		}

		// Deleting a hierarchy document also deletes its children with full access.
		if (
			entity.delete &&
			collection &&
			"hierarchy" in collection &&
			collection.hierarchy
		) {
			fail(
				`Collection "${slug}" is a folder or tag collection, whose deletes also delete their children with full access. Remove delete.`,
			);
		}

		// Payload 4 enables versions by default.
		entity.hasVersions = entity.read && Boolean(collection?.versions);
	}

	for (const entity of options.globals) {
		const global = config.globals.find(
			(candidate) => candidate.slug === entity.slug,
		);

		entity.hasVersions = entity.read && Boolean(global?.versions);
	}
};

const assertUserCollection = (
	collections: ConfigBySlug,
	slug: string,
): void => {
	const collection = collections.get(slug);

	if (!collection) {
		fail(`User collection "${slug}" does not exist.`);
	} else if (!("auth" in collection && collection.auth)) {
		fail(`User collection "${slug}" is not an auth collection.`);
	}
};

const assertTools = (
	tools: McpxAnyTool[],
	reserved: readonly string[],
): void => {
	const names = new Set<string>();

	for (const tool of tools) {
		if (!TOOL_NAME_PATTERN.test(tool.name)) {
			fail(`Tool name "${tool.name}" must match ${String(TOOL_NAME_PATTERN)}.`);
		}

		if (reserved.includes(tool.name)) {
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
 * Every problem is an `InvalidConfiguration`, so it fails at startup.
 * `reservedToolNames` are the builtin tool names custom tools must not reuse.
 */
export const normalizeOptions = (
	config: Config,
	options: McpxPluginOptions,
	reservedToolNames: readonly string[],
): NormalizedOptions => {
	const apiKeysSlug = options.apiKeys?.slug ?? DEFAULT_API_KEYS_SLUG;
	const userCollection =
		options.userCollection ?? config.admin?.user ?? "users";

	const collectionConfigs = bySlug(config.collections ?? []);

	if ("folders" in options) {
		fail(
			"The folders option was removed in 3.0; expose the folder collection under collections. See docs/integration.md#upgrading-to-30",
		);
	}

	if (collectionConfigs.has(apiKeysSlug)) {
		fail(`API key collection slug "${apiKeysSlug}" is already taken.`);
	}

	assertUserCollection(collectionConfigs, userCollection);

	const tools = options.tools ?? [];

	assertTools(tools, reservedToolNames);

	const collections = normalizeEntities(
		"Collection",
		config,
		collectionConfigs,
		options.collections,
		apiKeysSlug,
		foldersSlugOf(config),
	);
	// Only builtin tools are confirmable, so only `delete` needs approval.
	const confirmations = collections.some((entity) => entity.delete);

	/*
	 * Approval lives on the key document and the stored call is run by the key
	 * alone, which a custom resolver may not be able to replay.
	 */
	if (confirmations && options.auth?.resolve) {
		fail(
			"delete needs approval on the API key document, which a custom auth.resolve does not support. Remove delete: true or auth.resolve.",
		);
	}

	return {
		collections,
		globals: normalizeEntities(
			"Global",
			config,
			bySlug(config.globals ?? []),
			options.globals ?? {},
			apiKeysSlug,
		),
		userCollection,
		apiKeysSlug,
		endpointPath: options.endpoint?.path ?? DEFAULT_ENDPOINT_PATH,
		setupGuide: options.apiKeys?.setupGuide ?? true,
		limits: normalizeLimits(options.limits),
		tools,
		confirmations,
		auth: options.auth,
		serverInfo: {
			name: options.serverInfo?.name ?? "payloadcms-mcpx",
			version: options.serverInfo?.version ?? MCPX_VERSION,
		},
		diagnostics: options.diagnostics ?? true,
	};
};
