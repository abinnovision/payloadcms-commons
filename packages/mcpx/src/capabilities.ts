import type { NormalizedOptions } from "./options.js";
import type {
	McpxCollectionCapabilities as McpxEntityCapabilities,
	McpxExposedEntity,
	McpxResolvedCapabilities,
} from "./types.js";

/** Group field holding the capability checkboxes on an API key document. */
export const CAPABILITIES_FIELD = "capabilities";

/** Whatever the write lands on; {@link isLiveWrite} tells the two apart. */
export const canWrite = (entity: McpxExposedEntity): boolean =>
	entity.write !== false;

/** The config lets MCP change live content and there is a draft to promote. */
export const canPublish = (entity: McpxExposedEntity): boolean =>
	entity.write === "live" && entity.hasDrafts;

/**
 * With no versions there is no draft to land on, so `write: "live"` permits the
 * write at all and every write is live.
 */
export const isLiveWrite = (entity: McpxExposedEntity): boolean =>
	entity.write === "live" && !entity.hasDrafts;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const flag = (group: unknown, name: string): boolean =>
	isRecord(group) && group[name] === true;

/**
 * Publishing is an extension of writing, never a capability of its own: a key
 * that may publish may also edit the draft it publishes. Both checkboxes are
 * therefore required, on top of the config exposing publishing at all.
 */
const publishFlag = (entity: McpxExposedEntity, group: unknown): boolean =>
	canPublish(entity) && flag(group, "write") && flag(group, "publish");

/**
 * Capabilities in force for a key: the plugin config decides what can exist,
 * the key's checkboxes decide what does. A missing checkbox is `false`, so keys
 * issued before a capability existed stay closed.
 */
export const resolveCapabilities = (
	options: NormalizedOptions,
	keyCapabilities: unknown,
): McpxResolvedCapabilities => {
	const collectionsGroup = isRecord(keyCapabilities)
		? keyCapabilities["collections"]
		: undefined;
	const globalsGroup = isRecord(keyCapabilities)
		? keyCapabilities["globals"]
		: undefined;
	const toolsGroup = isRecord(keyCapabilities)
		? keyCapabilities["tools"]
		: undefined;

	const collections: McpxResolvedCapabilities["collections"] = {};

	for (const collection of options.collections) {
		const group = isRecord(collectionsGroup)
			? collectionsGroup[collection.fieldName]
			: undefined;

		collections[collection.slug] = {
			read: collection.read && flag(group, "read"),
			write: canWrite(collection) && flag(group, "write"),
			publish: publishFlag(collection, group),
		};
	}

	const globals: McpxResolvedCapabilities["globals"] = {};

	for (const global of options.globals) {
		const group = isRecord(globalsGroup)
			? globalsGroup[global.fieldName]
			: undefined;

		globals[global.slug] = {
			read: global.read && flag(group, "read"),
			write: canWrite(global) && flag(group, "write"),
			publish: publishFlag(global, group),
		};
	}

	const tools: McpxResolvedCapabilities["tools"] = {};

	for (const tool of options.tools) {
		tools[tool.name] = flag(toolsGroup, tool.name);
	}

	return { collections, globals, tools };
};

const pick = (
	entries: Record<string, McpxEntityCapabilities>,
	operation: "publish" | "read" | "write",
): string[] =>
	Object.entries(entries)
		.filter(([, value]) => value[operation])
		.map(([slug]) => slug);

/*
 * The lists tools read to narrow their enums. Derived from
 * {@link resolveCapabilities}, so config and checkbox have both been applied
 * by the time a slug appears in one.
 */
export const readableSlugs = (
	capabilities: McpxResolvedCapabilities,
): string[] => pick(capabilities.collections, "read");

export const writableSlugs = (
	capabilities: McpxResolvedCapabilities,
): string[] => pick(capabilities.collections, "write");

export const publishableSlugs = (
	capabilities: McpxResolvedCapabilities,
): string[] => pick(capabilities.collections, "publish");

export const readableGlobalSlugs = (
	capabilities: McpxResolvedCapabilities,
): string[] => pick(capabilities.globals, "read");

export const writableGlobalSlugs = (
	capabilities: McpxResolvedCapabilities,
): string[] => pick(capabilities.globals, "write");

export const publishableGlobalSlugs = (
	capabilities: McpxResolvedCapabilities,
): string[] => pick(capabilities.globals, "publish");
