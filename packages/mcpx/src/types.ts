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
 * A collection or global the plugin config exposes, before an API key's
 * checkboxes narrow it further.
 */
export interface McpxExposedEntity {
	slug: string;
	read: boolean;
	write: boolean;
	allowLiveWrites: boolean;
	hasDrafts: boolean;
	/** Name of the capability group on the key document. */
	fieldName: string;
}

/**
 * Everything a tool knows about the current request: the authenticated
 * request, what this key may touch and the limits in force.
 */
export interface McpxToolScope {
	req: PayloadRequest;
	capabilities: McpxResolvedCapabilities;
	/** Collection slugs the key may read / write. */
	readable: string[];
	writable: string[];
	/** Global slugs the key may read / write. */
	readableGlobals: string[];
	writableGlobals: string[];
	/** Configured locale codes, or `null` when localization is off. */
	locales: null | string[];
	defaultLocale: null | string;
	limits: { maxLimit: number; maxDepth: number };
	/** What the plugin config exposes, before the key's checkboxes apply. */
	exposure: {
		collections: McpxExposedEntity[];
		globals: McpxExposedEntity[];
	};
}

/**
 * A tool. The builtins and any tool passed through `options.tools` use this
 * same shape and register through the same loop. Every tool runs with
 * `req.user` resolved from the key and `req.context.mcpx` set.
 *
 * `Args` only needs stating when `inputSchema` is built per request, which
 * leaves no static shape to infer from; a tool with a fixed shape gets its
 * argument type from that shape.
 */
export interface McpxTool<
	Shape extends z.ZodRawShape = z.ZodRawShape,
	Args = z.infer<z.ZodObject<Shape>>,
> {
	/** camelCase, unique, not one of the builtin tool names. */
	name: string;
	/**
	 * Fixed text, or text built per request so it can state what this key's
	 * writes actually do.
	 */
	description: string | ((scope: McpxToolScope) => string);
	annotations?: ToolAnnotations;
	/**
	 * Whether this key may call the tool; a tool that is not enabled never
	 * appears in `tools/list`. Defaults to the tool's own checkbox on the API
	 * key, which the builtins replace to derive availability from the key's
	 * collection and global capabilities. Defining it replaces that checkbox
	 * check rather than adding to it.
	 */
	isEnabled?: (scope: McpxToolScope) => boolean;
	/**
	 * A fixed shape, or one built per request so enums can be narrowed to what
	 * the key may touch. Registered strictly either way: an unknown argument is
	 * rejected by name instead of being stripped and the tool answering as if
	 * it had not been passed.
	 */
	inputSchema?: Shape | ((scope: McpxToolScope) => z.ZodRawShape);
	/*
	 * Method syntax keeps the handler bivariant so tools with concrete
	 * argument types are assignable to `McpxTool[]`.
	 */
	// eslint-disable-next-line @typescript-eslint/method-signature-style
	handler(ctx: {
		args: Args;
		scope: McpxToolScope;
		/** Shorthand for `scope.req`. */
		req: PayloadRequest;
		extra: McpxToolExtra;
	}): CallToolResult | Promise<CallToolResult>;
}

/**
 * A tool with its argument type erased, which is how a registry holds tools of
 * differing input shapes. Each tool validates its own arguments through its
 * input schema.
 */
export type McpxAnyTool = McpxTool<z.ZodRawShape, never>;

/**
 * Defines a tool with a fixed input shape. The handler's arguments are
 * inferred from that shape.
 */
export function defineMcpxTool<Shape extends z.ZodRawShape>(
	tool: McpxTool<Shape> & { inputSchema?: Shape },
): McpxTool<Shape>;
/**
 * Defines a tool whose input shape is built per request and returned as an
 * object literal. The handler's arguments are inferred from that literal, so
 * a scope-narrowed enum still types as the value it produces.
 */
export function defineMcpxTool<Shape extends z.ZodRawShape>(
	tool: McpxTool<Shape> & {
		inputSchema: (scope: McpxToolScope) => Shape;
	},
): McpxAnyTool;
/**
 * Defines a tool whose input shape is assembled from helpers that erase to
 * `z.ZodRawShape`, as the builtins do. Nothing is left to infer from, so the
 * handler's arguments are stated instead: `defineMcpxTool<Args>({ ... })`.
 */
export function defineMcpxTool<Args>(
	tool: McpxTool<z.ZodRawShape, Args> & {
		inputSchema: (scope: McpxToolScope) => z.ZodRawShape;
	},
): McpxAnyTool;
export function defineMcpxTool(tool: McpxAnyTool): McpxAnyTool {
	return tool;
}

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
	tools?: McpxAnyTool[];
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

/**
 * One reason a human could not publish the draft as it stands.
 */
export interface PublishBlocker {
	/** Resolved field label path, e.g. "Layout > Block 2 (Hero) > Title". */
	field?: string;
	message: string;
	/** JSON Pointer to the offending value, e.g. "/layout/2/title". */
	path: string;
}
