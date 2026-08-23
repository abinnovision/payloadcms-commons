import type { NormalizedOptions } from "./options.js";
import type { McpxResolvedCapabilities } from "./types.js";

/** Name of the capability group on the key document. */
const CAPABILITIES_FIELD = "capabilities";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const flag = (group: unknown, name: string): boolean =>
	isRecord(group) && group[name] === true;

/**
 * Capabilities in force for a key: the plugin config decides what can exist,
 * the key's checkboxes decide what does. A missing checkbox is `false`, so keys
 * issued before a capability existed stay closed.
 */
const resolveCapabilities = (
	options: NormalizedOptions,
	keyCapabilities: unknown,
): McpxResolvedCapabilities => {
	const collectionsGroup = isRecord(keyCapabilities)
		? keyCapabilities["collections"]
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

	const tools: McpxResolvedCapabilities["tools"] = {};

	for (const tool of options.tools) {
		tools[tool.name] = flag(toolsGroup, tool.name);
	}

	return { collections, tools };
};

const readableSlugs = (capabilities: McpxResolvedCapabilities): string[] =>
	Object.entries(capabilities.collections)
		.filter(([, value]) => value.read)
		.map(([slug]) => slug);

const writableSlugs = (capabilities: McpxResolvedCapabilities): string[] =>
	Object.entries(capabilities.collections)
		.filter(([, value]) => value.write)
		.map(([slug]) => slug);

export {
	CAPABILITIES_FIELD,
	readableSlugs,
	resolveCapabilities,
	writableSlugs,
};
