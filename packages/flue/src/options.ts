import { InvalidConfiguration } from "payload";

import { ATTACHMENT_MIME_TYPES, maxBytesOf } from "./protocol/attachments.js";
import {
	DEFAULT_FILE_MIME_TYPES,
	FILE_LIMITS,
	isMimeType,
} from "./protocol/files.js";

import type { AttachmentLimits } from "./protocol/attachments.js";
import type { FlueAgentConfig, FluePluginOptions } from "./types.js";
import type { CollectionConfig, Config, PayloadRequest, Plugin } from "payload";

const MCPX_PLUGIN = "@abinnovision/payloadcms-mcpx";
const AGENT_SLUG = /^[a-z][a-z0-9-]{0,62}$/;
const SECRET_MIN_LENGTH = 32;
// Starts with a slash, ends without one, no whitespace.
const ENDPOINT_PATH = /^\/\S*[^\s/]$/;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const KEY_TTL = { min: 5 * MINUTE, max: 7 * DAY, default: 2 * 60 * MINUTE };
const DISPATCH_MAX_WAIT = 10 * MINUTE;

/** The jobs queue flue runs go to unless `dispatch.queue` names another. */
export const DISPATCH_QUEUE = "flue";

const KIB = 1024;
const MIB = 1024 * KIB;

/** The chat body cap without attachments. */
export const CHAT_BODY_MAX = 64 * KIB;

/*
 * Images stay within Anthropic's 5 MiB base64 image limit. PDFs stay under
 * Flue's 14 MiB base64 cap. Text files go into the turn's text, so their
 * cap keeps a turn within a model's context. Each file adds room for its
 * JSON keys and a file name of 255 characters escaped as `\uXXXX`.
 */
const ATTACHMENTS = {
	maxImageBytes: 3.75 * MIB,
	maxDocumentBytes: { default: 5 * MIB, max: 10 * MIB },
	maxTextBytes: { default: 512 * KIB, max: 2 * MIB },
	maxFiles: { default: 4, max: 20 },
	fileSlack: 2 * KIB,
};

/*
 * Payload's default multipart request limit. A file must leave room in it
 * for the form's other parts. Without temp files Payload holds an upload in
 * memory, so the file cap stays low unless the install opts in.
 */
const REQUEST_SIZE_LIMIT = 50 * MIB;
const REQUEST_SLACK = MIB;
// Payload's default `upload.limits.fileSize`, which caps each file of a request.
const FILE_SIZE_LIMIT = 20 * MIB;
const IN_MEMORY_MAX = 32 * MIB;

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
	/** `wait` is `false` when dispatch jobs return on admission. */
	dispatch: { queue: string; wait: false | { maxWaitMs: number } };
	/** `false` when chat attachments are off. */
	attachments: false | NormalizedAttachments;
	/** `false` when the file workspace is off. */
	files: false | NormalizedFiles;
	mcpx: McpxSettings;
}

/** The file workspace's settings after validation and defaulting. */
export interface NormalizedFiles {
	slug: string;
	mimeTypes: string[];
	/** Largest file in bytes. */
	maxBytes: number;
	maxFilesPerTurn: number;
	maxFilesPerThread: number;
	/** Text bytes of a turn's files that also go into its text. */
	inlineTextBytes: number;
	/** Limits of the files no turn has claimed yet. */
	pending: { maxFiles: number; maxBytes: number; ttlMs: number };
	overrideCollection:
		((collection: CollectionConfig) => CollectionConfig) | undefined;
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

type ConfigView = Pick<Config, "admin" | "collections" | "routes" | "upload">;
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

const normalizeWait = (
	option: NonNullable<FluePluginOptions["dispatch"]>["wait"],
): false | { maxWaitMs: number } => {
	if (option === undefined || option === false) {
		return false;
	}

	const { maxWaitMs = DISPATCH_MAX_WAIT } = option === true ? {} : option;

	if (!(Number.isFinite(maxWaitMs) && maxWaitMs > 0)) {
		throw invalid(
			`dispatch.wait.maxWaitMs must be a positive finite number, got ${String(maxWaitMs)}.`,
		);
	}

	return { maxWaitMs };
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
		maxTextBytes = ATTACHMENTS.maxTextBytes.default,
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

	if (!isCount(maxTextBytes, 1, ATTACHMENTS.maxTextBytes.max)) {
		throw invalid(
			`attachments.maxTextBytes must be between 1 and ${String(ATTACHMENTS.maxTextBytes.max)} (2 MiB), got ${String(maxTextBytes)}.`,
		);
	}

	if (!isCount(maxFiles, 1, ATTACHMENTS.maxFiles.max)) {
		throw invalid(
			`attachments.maxFiles must be between 1 and ${String(ATTACHMENTS.maxFiles.max)}, got ${String(maxFiles)}.`,
		);
	}

	const limits = { maxImageBytes, maxDocumentBytes, maxTextBytes };
	const largest = Math.max(
		...mimeTypes.map((mimeType) => maxBytesOf(limits, mimeType)),
	);

	return {
		mimeTypes: [...new Set(mimeTypes)],
		...limits,
		maxFiles,
		bodyMax:
			CHAT_BODY_MAX +
			maxFiles * (Math.ceil((largest * 4) / 3) + ATTACHMENTS.fileSlack),
	};
};

/*
 * The largest file Payload's multipart settings take. An unset `maxBytes`
 * follows them with a warning; an explicit one they cannot take fails.
 */
const normalizeMaxBytes = (
	maxBytes: number | undefined,
	upload: ConfigView["upload"],
	logger: StartupLogger,
): number => {
	const fits = Math.min(
		(upload?.requestSizeLimit ?? REQUEST_SIZE_LIMIT) - REQUEST_SLACK,
		upload?.limits?.fileSize ?? FILE_SIZE_LIMIT,
	);
	const tempFiles = upload?.useTempFiles === true;
	const settings =
		"Raise upload.requestSizeLimit and upload.limits.fileSize, and turn on upload.useTempFiles with a upload.tempFileDir in the Payload config";

	if (maxBytes === undefined) {
		const value = Math.min(
			FILE_LIMITS.maxBytes.default,
			fits,
			tempFiles ? Number.POSITIVE_INFINITY : IN_MEMORY_MAX,
		);

		if (value < 1) {
			throw invalid(
				`upload.requestSizeLimit and upload.limits.fileSize leave no room for files. ${settings}.`,
			);
		}

		if (value < FILE_LIMITS.maxBytes.default) {
			logger.warn(
				`[payloadcms-flue] files.maxBytes defaults to ${String(value)} bytes. ${settings} to take files up to 150 MiB.`,
			);
		}

		return value;
	}

	if (!isCount(maxBytes, 1, FILE_LIMITS.maxBytes.max)) {
		throw invalid(
			`files.maxBytes must be between 1 and ${String(FILE_LIMITS.maxBytes.max)} (1 GiB), got ${String(maxBytes)}.`,
		);
	}

	if (maxBytes > fits || (maxBytes > IN_MEMORY_MAX && !tempFiles)) {
		throw invalid(
			`files.maxBytes ${String(maxBytes)} is more than the Payload config takes. ${settings}, or lower files.maxBytes.`,
		);
	}

	return maxBytes;
};

const normalizeFiles = (
	option: FluePluginOptions["files"],
	upload: ConfigView["upload"],
	logger: StartupLogger,
): false | NormalizedFiles => {
	if (option === undefined || option === false) {
		return false;
	}

	const {
		slug = "flue-files",
		mimeTypes = [...DEFAULT_FILE_MIME_TYPES],
		maxBytes,
		maxFilesPerTurn = FILE_LIMITS.maxFilesPerTurn.default,
		maxFilesPerThread = FILE_LIMITS.maxFilesPerThread,
		inlineTextBytes = FILE_LIMITS.inlineTextBytes.default,
		pending: pendingOption,
		overrideCollection,
	} = option === true ? {} : option;

	if (mimeTypes.length === 0) {
		throw invalid("files.mimeTypes must name at least one type.");
	}

	for (const mimeType of mimeTypes) {
		if (!isMimeType(mimeType) || mimeType !== mimeType.toLowerCase()) {
			throw invalid(
				`files.mimeTypes entries must be exact MIME types, got "${mimeType}".`,
			);
		}
	}

	if (!isCount(maxFilesPerTurn, 1, FILE_LIMITS.maxFilesPerTurn.max)) {
		throw invalid(
			`files.maxFilesPerTurn must be between 1 and ${String(FILE_LIMITS.maxFilesPerTurn.max)}, got ${String(maxFilesPerTurn)}.`,
		);
	}

	// The thread's file listing is unpaginated and holds at most `listMax` files.
	if (!isCount(maxFilesPerThread, maxFilesPerTurn, FILE_LIMITS.listMax)) {
		throw invalid(
			`files.maxFilesPerThread must be between maxFilesPerTurn (${String(maxFilesPerTurn)}) and ${String(FILE_LIMITS.listMax)}, got ${String(maxFilesPerThread)}.`,
		);
	}

	if (!isCount(inlineTextBytes, 0, FILE_LIMITS.inlineTextBytes.max)) {
		throw invalid(
			`files.inlineTextBytes must be between 0 and ${String(FILE_LIMITS.inlineTextBytes.max)} (64 KiB), got ${String(inlineTextBytes)}.`,
		);
	}

	const fileBytes = normalizeMaxBytes(maxBytes, upload, logger);
	const limits = FILE_LIMITS.pending;
	const pending = pendingOption ?? {};
	const {
		maxFiles: pendingFiles = Math.max(limits.files.default, maxFilesPerTurn),
		maxBytes: pendingBytes = Math.max(limits.bytes.default, fileBytes),
		ttlMs = limits.ttlMs.default,
	} = pending;

	// A turn's worth of files must always fit among the pending ones.
	if (!isCount(pendingFiles, maxFilesPerTurn, limits.files.max)) {
		throw invalid(
			`files.pending.maxFiles must be between maxFilesPerTurn (${String(maxFilesPerTurn)}) and ${String(limits.files.max)}, got ${String(pendingFiles)}.`,
		);
	}

	if (!isCount(pendingBytes, fileBytes, limits.bytes.max)) {
		throw invalid(
			`files.pending.maxBytes must be between files.maxBytes (${String(fileBytes)}) and ${String(limits.bytes.max)} (10 GiB), got ${String(pendingBytes)}.`,
		);
	}

	if (!isCount(ttlMs, limits.ttlMs.min, limits.ttlMs.max)) {
		throw invalid(
			`files.pending.ttlMs must be between ${String(limits.ttlMs.min)} (1 hour) and ${String(limits.ttlMs.max)} (7 days), got ${String(ttlMs)}.`,
		);
	}

	return {
		slug,
		mimeTypes: [...new Set(mimeTypes)],
		maxBytes: fileBytes,
		maxFilesPerTurn,
		maxFilesPerThread,
		inlineTextBytes,
		pending: { maxFiles: pendingFiles, maxBytes: pendingBytes, ttlMs },
		overrideCollection,
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
	const wait = normalizeWait(options.dispatch?.wait);

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

	if (options.files && options.attachments) {
		throw invalid(
			"files and attachments cannot both be on. files sends a turn's files as references, attachments inline.",
		);
	}

	const files = normalizeFiles(options.files, config.upload, logger);

	if (files && (slugs.has(files.slug) || files.slug === threadsSlug)) {
		throw invalid(
			`files.slug "${files.slug}" is already taken by another collection.`,
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
		dispatch: { queue, wait },
		attachments: normalizeAttachments(options.attachments),
		files,
		mcpx,
	};
};
