import type { AttachmentMimeType } from "./protocol/attachments.js";
import type { ChatContext, RunKind } from "./protocol/context.js";
import type {
	CollectionConfig,
	DefaultDocumentIDType,
	PayloadRequest,
} from "payload";

export type { AttachmentMimeType } from "./protocol/attachments.js";

declare module "payload" {
	interface RequestContext {
		flue?: FlueRequestContext;
	}
}

/** What an agent may do with one collection, mapped onto its mcpx key. */
export interface FlueCollectionGrant {
	read?: boolean;
	write?: boolean;
	publish?: boolean;
	/** Goes through mcpx confirmation: the key's user approves each call. */
	delete?: boolean;
}

/** What an agent may do with one global. Globals cannot be deleted. */
export type FlueGlobalGrant = Omit<FlueCollectionGrant, "delete">;

/**
 * An agent's capabilities, keyed by collection slug, global slug and mcpx
 * custom tool name. Anything left out is refused. Payload access control
 * still applies to the acting user underneath.
 */
export interface FlueCapabilities {
	collections?: Record<string, FlueCollectionGrant>;
	globals?: Record<string, FlueGlobalGrant>;
	tools?: Record<string, boolean>;
}

/** One agent the sidecar serves. */
export interface FlueAgentConfig {
	/** The slug the agent is mounted under in the sidecar. */
	slug: string;
	label?: string;
	description?: string;
	capabilities: FlueCapabilities;
	/**
	 * Who may see and chat with the agent. Depend on `req.user` only: the key
	 * exchange evaluates it again on a request without headers or session.
	 * Server-side runs through jobs are not checked. Default: every user of
	 * the mcpx user collection.
	 */
	access?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>;
	/** Runs the agent on a schedule as the agent user. */
	ambient?: { cron: string; message: string };
}

export interface FluePluginOptions {
	/** The private Flue sidecar. The secret authenticates both directions. */
	sidecar: { url: string; secret: string };
	agents: FlueAgentConfig[];
	/**
	 * The existing user that reactive and ambient runs act as. Required once
	 * an agent has `ambient`.
	 */
	agentUser?: { email: string };
	/** How long a key and its exchange stay valid after a turn. Default 2 hours. */
	keyTtlMs?: number;
	/** Path of the plugin's endpoints below the API route. Default `/flue`. */
	endpointPath?: string;
	threads?: {
		/** Default `flue-threads`. */
		slug?: string;
		overrideCollection?: (collection: CollectionConfig) => CollectionConfig;
		/**
		 * Lets a user read reactive and ambient threads, which belong to the
		 * agent user. Default: nobody but the agent user.
		 */
		readAgentRuns?: (req: PayloadRequest) => boolean;
	};
	dispatch?: {
		/** The jobs queue flue runs are queued on. Default `flue`. */
		queue?: string;
		/**
		 * Keeps a `flue-dispatch` job open until its run settles, for up to
		 * `maxWaitMs`, and settles the thread itself; `true` waits up to 10
		 * minutes. A failed run fails the job. A timeout fails the job without
		 * stopping the run. A waiting job blocks its runner tick, so give each
		 * `flueQueues` queue its own autoRun entry and do not run these jobs
		 * from an HTTP runner. Default off.
		 */
		wait?: boolean | { maxWaitMs?: number };
	};
	/**
	 * Lets chat users attach images, PDFs and text files to a turn; `true`
	 * takes the defaults. Raises the chat body cap to fit the files. Default off.
	 */
	attachments?: boolean | FlueAttachmentOptions;
	/**
	 * Lets chat users upload files to a plugin-owned upload collection and
	 * send them with a turn as references; `true` takes the defaults. Agents
	 * read them through the sidecar. Excludes `attachments`. Default off.
	 */
	files?: boolean | FlueFileOptions;
}

/** The chat's file workspace. */
export interface FlueFileOptions {
	/** Default `flue-files`. */
	slug?: string;
	/**
	 * Exact `type/subtype` MIME types the chat takes; wildcards are refused.
	 * Default: `DEFAULT_FILE_MIME_TYPES`.
	 */
	mimeTypes?: string[];
	/**
	 * Largest file in bytes, at most 1 GiB. Default 150 MiB, lowered to what
	 * Payload's `upload.requestSizeLimit` and `upload.limits.fileSize` take
	 * and to 32 MiB unless `upload.useTempFiles` is on: 20 MiB at Payload's
	 * defaults.
	 */
	maxBytes?: number;
	/** Files per turn. Default 10, maximum 20. */
	maxFilesPerTurn?: number;
	/** Files per thread. Default 100, which is also the maximum. */
	maxFilesPerThread?: number;
	/**
	 * Text files up to this many bytes, all of a turn together, also go into
	 * the turn's text. Default 0, maximum 64 KiB.
	 */
	inlineTextBytes?: number;
	/** Limits of the files a user uploaded that no turn has claimed yet. */
	pending?: {
		/** Default 20, between `maxFilesPerTurn` and 100. */
		maxFiles?: number;
		/**
		 * In bytes. Default 300 MiB or `maxBytes` if larger, at most 10 GiB and
		 * at least `maxBytes`.
		 */
		maxBytes?: number;
		/** How long a pending file lives. Default 24 hours, from 1 hour to 7 days. */
		ttlMs?: number;
	};
	/** Must keep `upload.mimeTypes`, which makes Payload check each file's content. */
	overrideCollection?: (collection: CollectionConfig) => CollectionConfig;
}

/** Limits of chat attachments; each may only narrow the default. */
export interface FlueAttachmentOptions {
	/**
	 * Default: PNG, JPEG, GIF, WebP, PDF, Markdown, plain text and CSV. Text
	 * files reach the model inlined into the turn's text.
	 */
	mimeTypes?: AttachmentMimeType[];
	/** Largest decoded image in bytes. Default and maximum 3.75 MiB. */
	maxImageBytes?: number;
	/** Largest decoded PDF in bytes. Default 5 MiB, maximum 10 MiB. */
	maxDocumentBytes?: number;
	/**
	 * Largest decoded text of all text files of a turn, in bytes. Default
	 * 512 KiB, maximum 2 MiB.
	 */
	maxTextBytes?: number;
	/** Files per turn. Default 4, maximum 20. */
	maxFiles?: number;
}

/** The input of the `flue-dispatch` job task. */
export interface FlueRunInput {
	agent: string;
	message: string;
	kind: Exclude<RunKind, "chat">;
	/** The user whose action triggered the run. */
	onBehalfOf?: DefaultDocumentIDType;
	/** The document the run is about. */
	context?: Pick<ChatContext, "collection" | "global" | "id" | "locale">;
}

/** Stamped on `req.context.flue` for requests made on behalf of a run. */
export interface FlueRequestContext {
	agent: string;
	/** Absent while the thread row is being created. */
	thread?: DefaultDocumentIDType;
	kind: RunKind;
	onBehalfOf?: DefaultDocumentIDType;
	/** Set on the plugin's own writes, which may change fields users cannot. */
	internal?: boolean;
}
