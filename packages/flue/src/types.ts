import type { ChatContext, RunKind } from "./protocol/context.js";
import type {
	CollectionConfig,
	DefaultDocumentIDType,
	PayloadRequest,
} from "payload";

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
	};
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
