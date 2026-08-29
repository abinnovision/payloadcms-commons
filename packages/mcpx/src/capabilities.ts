import type { NormalizedOptions } from "./options.js";
import type {
	McpxCollectionCapabilities as McpxEntityCapabilities,
	McpxResolvedCapabilities,
} from "./types.js";

/** Name of the capability group on the key document. */
export const CAPABILITIES_FIELD = "capabilities";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const flag = (group: unknown, name: string): boolean =>
	isRecord(group) && group[name] === true;

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
			write: collection.write && flag(group, "write"),
		};
	}

	const globals: McpxResolvedCapabilities["globals"] = {};

	for (const global of options.globals) {
		const group = isRecord(globalsGroup)
			? globalsGroup[global.fieldName]
			: undefined;

		globals[global.slug] = {
			read: global.read && flag(group, "read"),
			write: global.write && flag(group, "write"),
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
	operation: "read" | "write",
): string[] =>
	Object.entries(entries)
		.filter(([, value]) => value[operation])
		.map(([slug]) => slug);

export const readableSlugs = (
	capabilities: McpxResolvedCapabilities,
): string[] => pick(capabilities.collections, "read");

export const writableSlugs = (
	capabilities: McpxResolvedCapabilities,
): string[] => pick(capabilities.collections, "write");

export const readableGlobalSlugs = (
	capabilities: McpxResolvedCapabilities,
): string[] => pick(capabilities.globals, "read");

export const writableGlobalSlugs = (
	capabilities: McpxResolvedCapabilities,
): string[] => pick(capabilities.globals, "write");
