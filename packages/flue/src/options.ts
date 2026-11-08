import { InvalidConfiguration } from "payload";

import {
	ATTACHMENT_MIME_TYPES,
	attachmentKind,
} from "./protocol/attachments.js";

import type { AttachmentLimits } from "./protocol/attachments.js";
import type { FlueAgentConfig, FluePluginOptions } from "./types.js";
import type { Config, PayloadRequest, Plugin } from "payload";

const MCPX_PLUGIN = "@abinnovision/payloadcms-mcpx";
const AGENT_SLUG = /^[a-z][a-z0-9-]{0,62}$/;
const SECRET_MIN_LENGTH = 32;
// Starts with a slash, ends without one, no whitespace.
const ENDPOINT_PATH = /^\/\S*[^\s/]$/;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const KEY_TTL = { min: 5 * MINUTE, max: 7 * DAY, default: 2 * 60 * MINUTE };

/** The jobs queue flue runs go to unless `dispatch.queue` names another. */
export const DISPATCH_QUEUE = "flue";

const KIB = 1024;
const MIB = 1024 * KIB;

/** The chat body cap without attachments. */
export const CHAT_BODY_MAX = 64 * KIB;

/*
 * Images stay within Anthropic's 5 MiB base64 image limit. PDFs stay under
 * Flue's 14 MiB base64 cap. Each file adds room for its JSON keys and a
 * file name of 255 characters escaped as `\uXXXX`.
 */
const ATTACHMENTS = {
	maxImageBytes: 3.75 * MIB,
	maxDocumentBytes: { default: 5 * MIB, max: 10 * MIB },
	maxFiles: { default: 4, max: 20 },
	fileSlack: 2 * KIB,
};

/** The subset of mcpx's options flue reads. */
interface McpxOptions {
	apiKeys?: { slug?: string };
	userCollection?: string;
	endpoint?: { path?: string };
}

/** What flue needs to know about the installed mcpx plugin. */
export interface McpxSettings {
	apiKeysSlug: string;
	userCollection: string;
	endpointPath: string;
	/** `endpointPath` below the API route, as a client requests it. */
	mcpPath: string;
}

/**
 * The plugin options after validation and defaulting, the only shape the rest
 * of the plugin reads.
 */
export interface NormalizedOptions {
	sidecar: { url: string; secret: string };
	agents: FlueAgentConfig[];
	agentUser: { email: string } | undefined;
	keyTtlMs: number;
	endpointPath: string;
	threads: { slug: string; readAgentRuns: (req: PayloadRequest) => boolean };
	dispatch: { queue: string };
	/** `false` when chat attachments are off. */
	attachments: false | NormalizedAttachments;
	mcpx: McpxSettings;
}

/** The attachment limits plus the chat body cap they imply. */
export interface NormalizedAttachments extends AttachmentLimits {
	/** The chat body cap in bytes. */
	bodyMax: number;
}

/** Receives what normalizing finds that is reported only at startup. */
export interface StartupLogger {
	warn: (message: string) => void;
	/** A missing setting, which fails the server's startup but not a build. */
	fail: (error: InvalidConfiguration) => void;
}

type ConfigView = Pick<Config, "admin" | "collections" | "routes">;
type PluginsView = Readonly<Record<string, Plugin | undefined>>;

/** An option or config error, with the plugin's prefix. */
export const invalid = (message: string): InvalidConfiguration =>
	new InvalidConfiguration(`[payloadcms-flue] ${message}`);

/**
 * mcpx's key collection, user collection and endpoint, with mcpx's own
 * defaults restated because mcpx does not export its resolver. Throws where
 * mcpx is not installed.
 */
export const mcpxSettings = (
	config: ConfigView,
	plugins: PluginsView,
): McpxSettings => {
	const mcpx = plugins[MCPX_PLUGIN];

	if (mcpx === undefined) {
		throw invalid(
			`The mcpx plugin (${MCPX_PLUGIN}) is not installed. Agents reach Payload through it.`,
		);
	}

	// definePlugin leaves `options` unset when mcpx is registered without arguments.
	const options = (mcpx.options ?? {}) as McpxOptions;
	const endpointPath = options.endpoint?.path ?? "/mcpx";

	return {
		apiKeysSlug: options.apiKeys?.slug ?? "mcpx-api-keys",
		userCollection: options.userCollection ?? config.admin?.user ?? "users",
		endpointPath,
		mcpPath: `${config.routes?.api ?? "/api"}${endpointPath}`,
	};
};

const isHttpUrl = (value: string): boolean => {
	if (!URL.canParse(value)) {
		return false;
	}

	const { protocol } = new URL(value);

	return protocol === "http:" || protocol === "https:";
};

const isUnset = (value: unknown): boolean =>
	value === undefined || value === "";

/*
 * Both values usually come from environment variables. A build may run
 * without them, so an unset value fails at startup; a malformed one fails
 * here.
 */
const assertSidecar = (
	{ url, secret }: FluePluginOptions["sidecar"],
	logger: StartupLogger,
): void => {
	const badUrl = invalid(
		`sidecar.url must be an absolute http(s) URL, got "${url}".`,
	);
	// The secret's value never goes into the message.
	const badSecret = invalid(
		`sidecar.secret must be a string of at least ${String(SECRET_MIN_LENGTH)} characters.`,
	);

	if (isUnset(url)) {
		logger.fail(badUrl);
	} else if (typeof url !== "string" || !isHttpUrl(url)) {
		throw badUrl;
	}

	if (isUnset(secret)) {
		logger.fail(badSecret);
	} else if (typeof secret !== "string" || secret.length < SECRET_MIN_LENGTH) {
		throw badSecret;
	}
};

const assertAgents = (agents: FlueAgentConfig[]): void => {
	if (agents.length === 0) {
		throw invalid("agents must name at least one agent.");
	}

	const seen = new Set<string>();

	for (const [index, agent] of agents.entries()) {
		if (!AGENT_SLUG.test(agent.slug)) {
			throw invalid(
				`agents[${String(index)}].slug "${agent.slug}" must match ${AGENT_SLUG.source}.`,
			);
		}

		if (seen.has(agent.slug)) {
			throw invalid(
				`agents[${String(index)}].slug "${agent.slug}" is used by another agent.`,
			);
		}

		seen.add(agent.slug);

		if (agent.ambient && agent.ambient.cron.trim() === "") {
			throw invalid(`agents[${String(index)}].ambient.cron must not be empty.`);
		}

		if (agent.ambient && agent.ambient.message.trim() === "") {
			throw invalid(
				`agents[${String(index)}].ambient.message must not be empty.`,
			);
		}
	}
};

const isCount = (value: number, min: number, max: number): boolean =>
	Number.isInteger(value) && value >= min && value <= max;

const normalizeAttachments = (
	option: FluePluginOptions["attachments"],
): false | NormalizedAttachments => {
	if (option === undefined || option === false) {
		return false;
	}

	const {
		mimeTypes = [...ATTACHMENT_MIME_TYPES],
		maxImageBytes = ATTACHMENTS.maxImageBytes,
		maxDocumentBytes = ATTACHMENTS.maxDocumentBytes.default,
		maxFiles = ATTACHMENTS.maxFiles.default,
	} = option === true ? {} : option;

	if (mimeTypes.length === 0) {
		throw invalid("attachments.mimeTypes must name at least one type.");
	}

	for (const mimeType of mimeTypes) {
		if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
			throw invalid(
				`attachments.mimeTypes may only hold ${ATTACHMENT_MIME_TYPES.join(", ")}, got "${mimeType}".`,
			);
		}
	}

	if (!isCount(maxImageBytes, 1, ATTACHMENTS.maxImageBytes)) {
		throw invalid(
			`attachments.maxImageBytes must be between 1 and ${String(ATTACHMENTS.maxImageBytes)} (3.75 MiB), got ${String(maxImageBytes)}.`,
		);
	}

	if (!isCount(maxDocumentBytes, 1, ATTACHMENTS.maxDocumentBytes.max)) {
		throw invalid(
			`attachments.maxDocumentBytes must be between 1 and ${String(ATTACHMENTS.maxDocumentBytes.max)} (10 MiB), got ${String(maxDocumentBytes)}.`,
		);
	}

	if (!isCount(maxFiles, 1, ATTACHMENTS.maxFiles.max)) {
		throw invalid(
			`attachments.maxFiles must be between 1 and ${String(ATTACHMENTS.maxFiles.max)}, got ${String(maxFiles)}.`,
		);
	}

	const largest = Math.max(
		...mimeTypes.map((mimeType) =>
			attachmentKind(mimeType) === "image" ? maxImageBytes : maxDocumentBytes,
		),
	);

	return {
		mimeTypes: [...new Set(mimeTypes)],
		maxImageBytes,
		maxDocumentBytes,
		maxFiles,
		bodyMax:
			CHAT_BODY_MAX +
			maxFiles * (Math.ceil((largest * 4) / 3) + ATTACHMENTS.fileSlack),
	};
};

/**
 * Validates the options against the config at startup and fills in the
 * defaults. Expects mcpx to have run first, so its key collection is in
 * `config.collections`.
 */
export const normalizeOptions = (
	config: ConfigView,
	options: FluePluginOptions,
	plugins: PluginsView,
	logger: StartupLogger,
): NormalizedOptions => {
	const mcpx = mcpxSettings(config, plugins);
	const slugs = new Set(
		(config.collections ?? []).map((collection) => collection.slug),
	);

	if (!slugs.has(mcpx.apiKeysSlug)) {
		throw invalid(
			`The mcpx API key collection "${mcpx.apiKeysSlug}" is not in the config. flue must run after mcpx.`,
		);
	}

	assertSidecar(options.sidecar, logger);
	assertAgents(options.agents);

	if (
		options.agents.some((agent) => agent.ambient) &&
		!options.agentUser?.email.trim()
	) {
		throw invalid(
			"agentUser.email is required when an agent has ambient runs.",
		);
	}

	const keyTtlMs = options.keyTtlMs ?? KEY_TTL.default;

	if (!(keyTtlMs >= KEY_TTL.min && keyTtlMs <= KEY_TTL.max)) {
		throw invalid(
			`keyTtlMs must be between ${String(KEY_TTL.min)} (5 minutes) and ${String(KEY_TTL.max)} (7 days), got ${String(keyTtlMs)}.`,
		);
	}

	const queue = options.dispatch?.queue ?? DISPATCH_QUEUE;

	const endpointPath = options.endpointPath ?? "/flue";

	if (!ENDPOINT_PATH.test(endpointPath)) {
		throw invalid(
			`endpointPath must start with "/", end without one and contain no whitespace, got "${endpointPath}".`,
		);
	}

	if (endpointPath === mcpx.endpointPath) {
		throw invalid(
			`endpointPath "${endpointPath}" is already mcpx's endpoint path.`,
		);
	}

	const threadsSlug = options.threads?.slug ?? "flue-threads";

	if (slugs.has(threadsSlug)) {
		throw invalid(
			`threads.slug "${threadsSlug}" is already taken by another collection.`,
		);
	}

	return {
		sidecar: { url: options.sidecar.url, secret: options.sidecar.secret },
		agents: options.agents,
		agentUser: options.agentUser,
		keyTtlMs,
		endpointPath,
		threads: {
			slug: threadsSlug,
			readAgentRuns: options.threads?.readAgentRuns ?? (() => false),
		},
		dispatch: { queue },
		attachments: normalizeAttachments(options.attachments),
		mcpx,
	};
};
