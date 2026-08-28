import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	CallToolResult,
	ServerNotification,
	ServerRequest,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type {
	CollectionConfig,
	CollectionSlug,
	GlobalSlug,
	PayloadRequest,
	TypedUser,
} from "payload";
import type { z } from "zod";

declare module "payload" {
	interface RequestContext {
		mcpx?: McpxRequestContext;
	}

	interface RegisteredPlugins {
		"@abinnovision/payloadcms-mcpx": McpxPluginOptions;
	}
}

/**
 * What an exposed collection offers to MCP clients. A key can only enable
 * what the config exposes here.
 */
export interface McpxCollectionOptions {
	/**
	 * Expose `describeSchema`, `findDocuments` and `getDocument`. Default `true`.
	 */
	read?: boolean;

	/**
	 * Expose `patchDocument`, `createDocument` and `validateDocument`. Default
	 * `false`. Requires `versions.drafts` unless `allowLiveWrites` is set.
	 */
	write?: boolean;

	/**
	 * Permit writes to a collection without drafts. Such writes land on the live
	 * document because there is no draft to land on. Default `false`.
	 */
	allowLiveWrites?: boolean;
}

/**
 * What an exposed global offers to MCP clients. Structurally the same as
 * {@link McpxCollectionOptions}, kept separate because the tools it names
 * differ: a global is a singleton, so neither `findDocuments` nor
 * `createDocument` reaches one.
 */
export interface McpxGlobalOptions {
	/** Expose `describeSchema` and `getDocument`. Default `true`. */
	read?: boolean;
	/**
	 * Expose `patchDocument` and `validateDocument`. Default `false`. Requires
	 * `versions.drafts` unless `allowLiveWrites` is set.
	 */
	write?: boolean;
	/**
	 * Permit writes to a global without drafts. Such writes land on the live
	 * document because there is no draft to land on. Default `false`.
	 */
	allowLiveWrites?: boolean;
}

export type McpxToolExtra = RequestHandlerExtra<
	ServerRequest,
	ServerNotification
>;

/**
 * A custom tool. It is gated by its own checkbox on every API key and runs
 * with `req.user` resolved from the key and `req.context.mcpx` set.
 */
export interface McpxTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
	/** camelCase, unique, not one of the builtin tool names. */
	name: string;
	description: string;
	inputSchema?: Shape;
	annotations?: ToolAnnotations;
	/*
	 * Method syntax keeps the handler bivariant so tools with concrete
	 * shapes are assignable to `McpxTool[]`.
	 */
	// eslint-disable-next-line @typescript-eslint/method-signature-style
	handler(ctx: {
		args: z.infer<z.ZodObject<Shape>>;
		req: PayloadRequest;
		extra: McpxToolExtra;
	}): CallToolResult | Promise<CallToolResult>;
}

/**
 * Identity helper that infers the argument type of a custom tool's handler
 * from its input schema.
 */
export const defineMcpxTool = <Shape extends z.ZodRawShape>(
	tool: McpxTool<Shape>,
): McpxTool<Shape> => tool;

/**
 * Outcome of resolving an API key. `user` must carry `collection`.
 */
export interface McpxAuthResult {
	user: TypedUser;
	apiKeyId: number | string;
	/** The `capabilities` group as stored on the key document. */
	capabilities: unknown;
}

/*
 * A type alias rather than an interface: `definePlugin` constrains its options
 * to `Record<string, unknown>`, which interfaces do not satisfy.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type McpxPluginOptions = {
	/** Allow-list of collections. `true` is shorthand for `{ read: true }`. */
	collections: Partial<Record<CollectionSlug, McpxCollectionOptions | true>>;
	/** Allow-list of globals. `true` is shorthand for `{ read: true }`. */
	globals?: Partial<Record<GlobalSlug, McpxGlobalOptions | true>>;
	/** Collection the keys act as. Default `config.admin.user`, then `users`. */
	userCollection?: CollectionSlug;
	apiKeys?: {
		/** Slug of the generated API key collection. Default `mcpx-api-keys`. */
		slug?: string;
		/**
		 * Add a "Connect a client" tab to saved keys, holding ready-to-paste MCP
		 * client config. Default `true`. The snippets contain the key in full.
		 */
		setupGuide?: boolean;
		/** Final override applied to the generated collection. */
		overrideCollection?: (collection: CollectionConfig) => CollectionConfig;
	};
	endpoint?: {
		/** Endpoint path below the API route. Default `/mcpx`. */
		path?: string;
	};
	limits?: {
		/** Upper bound for `findDocuments.limit`. Default 25. */
		maxLimit?: number;
		/** Upper bound for `depth` on reads. Default 1. */
		maxDepth?: number;
	};
	tools?: McpxTool[];
	auth?: {
		/** Replace or wrap the default key resolution. Return `null` for 401. */
		resolve?: (args: {
			req: PayloadRequest;
			resolveDefault: () => Promise<McpxAuthResult | null>;
		}) => Promise<McpxAuthResult | null>;
	};
	serverInfo?: { name?: string; version?: string };
};

export interface McpxCollectionCapabilities {
	read: boolean;
	write: boolean;
}

/**
 * Capabilities in force for one request: plugin config AND key checkboxes.
 */
export interface McpxResolvedCapabilities {
	collections: Record<string, McpxCollectionCapabilities>;
	globals: Record<string, McpxCollectionCapabilities>;
	tools: Record<string, boolean>;
}

export interface McpxRequestContext {
	apiKeyId: number | string;
	capabilities: McpxResolvedCapabilities;
}
