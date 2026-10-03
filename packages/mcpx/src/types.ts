import type { DocumentId } from "./entity.js";
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
 * - `"live"`: MCP may change live content. On an entity with drafts that
 *   exposes `publishDocument`. On one without, there is no draft, so the write
 *   itself is permitted and lands live.
 */
export type McpxWriteMode = "draft" | "live" | false;

/**
 * What an entity exposes. The config names the entities that are reachable and
 * only takes capabilities away; a key's checkboxes decide per key. `true` is
 * shorthand for `{}`, which exposes everything the entity supports.
 */
export interface McpxCollectionOptions {
	/**
	 * Expose `describeSchema`, `findDocuments`, `getDocument`. Default `true`.
	 */
	read?: boolean;
	/**
	 * Expose `patchDocument`, `validateDocument` and, unless this is an upload
	 * collection, `createDocument`. Without drafts a write changes live
	 * content. Default `true`.
	 */
	write?: boolean;
	/**
	 * Expose `publishDocument`, which promotes a draft to live content. Needs
	 * `versions.drafts` and `write`. Default `true` where the entity has drafts.
	 * `false` keeps writes as drafts and is refused where there are none.
	 */
	publish?: boolean;
}

/**
 * The same options. A singleton, so neither `findDocuments` nor
 * `createDocument` reaches one.
 */
export type McpxGlobalOptions = McpxCollectionOptions;

export type McpxToolExtra = RequestHandlerExtra<
	ServerRequest,
	ServerNotification
>;

/**
 * What the config exposes, before an API key's checkboxes narrow it.
 */
export interface McpxExposedEntity {
	slug: string;
	read: boolean;
	write: McpxWriteMode;
	hasDrafts: boolean;
	/**
	 * The entity has Payload `versions`, with or without drafts, and is
	 * readable. Says nothing about drafts; see `hasDrafts`.
	 */
	hasVersions: boolean;
	/**
	 * An upload document is a file, and no tool here can supply one.
	 */
	isUpload: boolean;
	/**
	 * Name of the capability group on the key document.
	 */
	fieldName: string;
}

/**
 * The slugs a key may read, write and publish.
 */
export interface McpxScopeSlugs {
	readable: string[];
	writable: string[];
	publishable: string[];
}

/**
 * What a tool knows about the current request.
 */
export interface McpxToolScope {
	req: PayloadRequest;
	capabilities: McpxResolvedCapabilities;
	collections: McpxScopeSlugs;
	globals: McpxScopeSlugs;
	/**
	 * `null` when localization is off.
	 */
	localization: null | { locales: string[]; defaultLocale: string };
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
	/**
	 * camelCase, unique, not one of the builtin tool names.
	 */
	name: string;
	/**
	 * Built per request so it can state what this key's writes do.
	 */
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
	 * instead of stripped.
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
		/**
		 * Shorthand for `scope.req`.
		 */
		req: PayloadRequest;
		extra: McpxToolExtra;
	}): CallToolResult | Promise<CallToolResult>;
}

/**
 * Argument type erased, so a registry can hold tools of differing shapes.
 */
export type McpxAnyTool = McpxTool<z.ZodRawShape, never>;

export interface McpxAuthResult {
	/**
	 * Must carry `collection`.
	 */
	user: TypedUser;
	apiKeyId: DocumentId;
	/**
	 * The `capabilities` group as stored on the key document.
	 */
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
	/**
	 * Allow-list of collections. `true` is shorthand for `{}`.
	 */
	collections: Partial<Record<CollectionSlug, McpxCollectionOptions | true>>;
	/**
	 * Allow-list of globals. `true` is shorthand for `{}`.
	 */
	globals?: Partial<Record<GlobalSlug, McpxGlobalOptions | true>>;
	/**
	 * Collection the keys act as. Default `config.admin.user`, then `users`.
	 */
	userCollection?: CollectionSlug;
	apiKeys?: {
		/**
		 * Slug of the generated API key collection. Default `mcpx-api-keys`.
		 */
		slug?: string;
		/**
		 * Add a "Connect a client" tab to saved keys, holding ready-to-paste MCP
		 * client config. Default `true`. The snippets contain the key in full.
		 */
		setupGuide?: boolean;
		/**
		 * Final override applied to the generated collection.
		 */
		overrideCollection?: (collection: CollectionConfig) => CollectionConfig;
	};
	endpoint?: {
		/**
		 * Endpoint path below the API route. Default `/mcpx`.
		 */
		path?: string;
	};
	limits?: {
		/**
		 * Upper bound for `findDocuments.limit`. Default 25.
		 */
		maxLimit?: number;
		/**
		 * Upper bound for `depth` on reads. Default 1.
		 */
		maxDepth?: number;
	};
	tools?: McpxAnyTool[];
	auth?: {
		/**
		 * Replace or wrap the default key resolution. Return `null` for 401. A
		 * result whose user has no `id` or whose `collection` is not the user
		 * collection, or that has no `apiKeyId`, is also answered with 401.
		 */
		resolve?: (args: {
			req: PayloadRequest;
			resolveDefault: () => Promise<McpxAuthResult | null>;
		}) => Promise<McpxAuthResult | null>;
	};
	serverInfo?: { name?: string; version?: string };
};

/**
 * What a key may do with one entity. Globals reuse this shape.
 */
export interface McpxCollectionCapabilities {
	read: boolean;
	write: boolean;
	/**
	 * Only ever true where the config lets writes publish and drafts exist.
	 */
	publish: boolean;
}

/**
 * In force for one request: the plugin config and the key checkboxes together.
 */
export interface McpxResolvedCapabilities {
	collections: Record<string, McpxCollectionCapabilities>;
	globals: Record<string, McpxCollectionCapabilities>;
	tools: Record<string, boolean>;
}

/**
 * Stamped on `req.context.mcpx`; see {@link isMcpxRequest}.
 */
export interface McpxRequestContext {
	apiKeyId: DocumentId;
	capabilities: McpxResolvedCapabilities;
}
