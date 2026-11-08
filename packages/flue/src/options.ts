import { InvalidConfiguration } from "payload";

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
	mcpx: McpxSettings;
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
		mcpx,
	};
};
