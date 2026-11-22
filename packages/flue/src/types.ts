import type { FileDeliver } from "./protocol/attachments.js";
import type { ChatContext, RunKind } from "./protocol/context.js";
import type {
	CollectionConfig,
	DefaultDocumentIDType,
	PayloadRequest,
} from "payload";

export type { FileDeliver, FileDelivery } from "./protocol/attachments.js";

declare module "payload" {
	interface RequestContext {
		flue?: FlueRequestContext;
	}
}

/** What an agent may do with one collection, handed to mcpx with its token. */
export interface FlueCollectionGrant {
	read?: boolean;
	write?: boolean;
	publish?: boolean;
	/** Goes through mcpx confirmation: the thread's user approves each call. */
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
	 * Who may see and chat with the agent. Depend on `req.user` only: the token
	 * exchange evaluates it again on a request without headers or session.
	 * Server-side runs through jobs are not checked. Default: every user of
	 * the mcpx user collection.
	 */
	access?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>;
	/** Runs the agent on a schedule as the agent user. */
	ambient?: { cron: string; message: string };
	/**
	 * Lets chat users send the agent files of `files.collection`; `deliver`
	 * replaces the plugin-wide policy for this agent. Implies the read grant
	 * on the collection, which `flueThreadScoped` narrows. Default off.
	 */
	files?: boolean | { deliver?: FileDeliver };
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
	/**
	 * How long a thread's live window stays open after a turn, and the
	 * longest an agent token lives; no token outlives its thread's window.
	 * Between 5 minutes and 24 hours, and at least `dispatch.wait.maxWaitMs`.
	 * Default 1 hour.
	 */
	tokenTtlMs?: number;
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
	 * The admin chat. `false` mounts neither the chat nor the document
	 * bridge, for an install that runs agents from hooks and schedules only.
	 * `documentBridge` keeps open edit views in step with the agent's writes:
	 * `false` mounts it nowhere, lists mount it on those slugs only. Default:
	 * the chat, and the bridge on every collection and global.
	 */
	admin?:
		| false
		| {
				documentBridge?:
					boolean | { collections?: string[]; globals?: string[] };
		  };
	/**
	 * Lets chat users send files of an upload collection the app defines with
	 * a turn, to the agents that opt in with their own `files`. Default off.
	 */
	files?: FlueFileOptions;
}

/** The chat's files. */
export interface FlueFileOptions {
	/**
	 * An upload collection that sets `upload.mimeTypes` and keeps
	 * `authorship`. The plugin adds a server-only `flueThread` field and
	 * scopes agent reads to the current thread.
	 */
	collection: string;
	/** Files per turn. Default 10, maximum 20. */
	maxFilesPerTurn?: number;
	/**
	 * Whether each file is attached or referenced. Default `defaultDeliver`.
	 * Only images and PDFs within Flue's caps and the per-turn budget are
	 * attached, whatever it answers.
	 */
	deliver?: FileDeliver;
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
