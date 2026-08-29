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
 * How far an exposed entity lets MCP writes reach.
 *
 * - `false`: no write tool touches it.
 * - `"draft"`: writes land as drafts and nothing MCP does changes what the
 *   public sees. Requires `versions.drafts`.
 * - `"live"`: MCP may change live content. On an entity with drafts that means
 *   `publishDocument` is exposed; on one without, where there is no draft to
 *   land on, it means the write itself is permitted and lands live.
 */
export type McpxWriteMode = "draft" | "live" | false;

/** A key can only enable what the config exposes here. */
export interface McpxCollectionOptions {
	/** Expose `describeSchema`, `findDocuments`, `getDocument`. Default `true`. */
	read?: boolean;
	/**
	 * Expose `patchDocument`, `validateDocument` and, unless this is an upload
	 * collection, `createDocument`, and how far those writes reach. Default
	 * `false`.
	 */
	write?: McpxWriteMode;
}

/** A singleton, so neither `findDocuments` nor `createDocument` reaches one. */
export interface McpxGlobalOptions {
	/** Expose `describeSchema` and `getDocument`. Default `true`. */
	read?: boolean;
	/**
	 * Expose `patchDocument` and `validateDocument`, and how far those writes
	 * reach. Default `false`.
	 */
	write?: McpxWriteMode;
}

export type McpxToolExtra = RequestHandlerExtra<
	ServerRequest,
	ServerNotification
>;

/** What the config exposes, before an API key's checkboxes narrow it. */
export interface McpxExposedEntity {
	slug: string;
	read: boolean;
	write: McpxWriteMode;
	hasDrafts: boolean;
	/** An upload document is a file, and no tool here can supply one. */
	isUpload: boolean;
	/** Name of the capability group on the key document. */
	fieldName: string;
}

/** What a tool knows about the current request. */
export interface McpxToolScope {
	req: PayloadRequest;
	capabilities: McpxResolvedCapabilities;
	readable: string[];
	writable: string[];
	publishable: string[];
	readableGlobals: string[];
	writableGlobals: string[];
	publishableGlobals: string[];
	/** `null` when localization is off. */
	locales: null | string[];
	defaultLocale: null | string;
	limits: { maxLimit: number; maxDepth: number };
	exposure: {
		collections: McpxExposedEntity[];
		globals: McpxExposedEntity[];
	};
}

/**
 * A tool, builtin or custom. Runs with `req.user` resolved from the key and
 * `req.context.mcpx` set. `Args` only needs stating when `inputSchema` is built
 * per request, leaving no static shape to infer from.
 */
export interface McpxTool<
	Shape extends z.ZodRawShape = z.ZodRawShape,
	Args = z.infer<z.ZodObject<Shape>>,
> {
	/** camelCase, unique, not one of the builtin tool names. */
	name: string;
	/** Built per request so it can state what this key's writes actually do. */
	description: string | ((scope: McpxToolScope) => string);
	annotations?: ToolAnnotations;
	/**
	 * A tool that is not enabled never appears in `tools/list`. Defaults to the
	 * tool's own checkbox on the API key; defining it replaces that check rather
	 * than adding to it.
	 */
	isEnabled?: (scope: McpxToolScope) => boolean;
	/**
	 * Built per request so enums can be narrowed to what the key may touch.
	 * Registered strictly either way: an unknown argument is rejected by name
	 * rather than stripped.
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

/** Argument type erased, so a registry can hold tools of differing shapes. */
export type McpxAnyTool = McpxTool<z.ZodRawShape, never>;

/** Fixed shape; arguments inferred from it. */
export function defineMcpxTool<Shape extends z.ZodRawShape>(
	tool: McpxTool<Shape> & { inputSchema?: Shape },
): McpxTool<Shape>;
/** Per-request shape returned as an object literal; arguments inferred from it. */
export function defineMcpxTool<Shape extends z.ZodRawShape>(
	tool: McpxTool<Shape> & {
		inputSchema: (scope: McpxToolScope) => Shape;
	},
): McpxAnyTool;
/**
 * Per-request shape built from helpers that erase to `z.ZodRawShape`, as the
 * builtins do. Nothing to infer from, so state the arguments instead.
 */
export function defineMcpxTool<Args>(
	tool: McpxTool<z.ZodRawShape, Args> & {
		inputSchema: (scope: McpxToolScope) => z.ZodRawShape;
	},
): McpxAnyTool;
export function defineMcpxTool(tool: McpxAnyTool): McpxAnyTool {
	return tool;
}

export interface McpxAuthResult {
	/** Must carry `collection`. */
	user: TypedUser;
	apiKeyId: number | string;
	/** The `capabilities` group as stored on the key document. */
	capabilities: unknown;
}

/**
 * Everything the plugin accepts. `collections` is the only required option.
 *
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

/** What a key may do with one entity. Globals reuse this shape. */
export interface McpxCollectionCapabilities {
	read: boolean;
	write: boolean;
	/** Only ever true where the config sets `write: "live"` and drafts exist. */
	publish: boolean;
}

/** In force for one request: plugin config AND key checkboxes. */
export interface McpxResolvedCapabilities {
	collections: Record<string, McpxCollectionCapabilities>;
	globals: Record<string, McpxCollectionCapabilities>;
	tools: Record<string, boolean>;
}

/** Stamped on `req.context.mcpx`; see {@link isMcpxRequest}. */
export interface McpxRequestContext {
	apiKeyId: number | string;
	capabilities: McpxResolvedCapabilities;
}

/** One reason a human could not publish the draft as it stands. */
export interface PublishBlocker {
	/** Resolved field label path, e.g. "Layout > Block 2 (Hero) > Title". */
	field?: string;
	message: string;
	/** JSON Pointer to the offending value, e.g. "/layout/2/title". */
	path: string;
}
