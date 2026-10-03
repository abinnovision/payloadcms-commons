import { isPlainObject } from "./guards.js";

import type { NormalizedOptions } from "./options.js";
import type {
	McpxCollectionCapabilities as McpxEntityCapabilities,
	McpxExposedEntity,
	McpxResolvedCapabilities,
	McpxScopeSlugs,
} from "./types.js";

/** Group field holding the capability checkboxes on an API key document. */
export const CAPABILITIES_FIELD = "capabilities";

/** Covers draft and live writes; {@link isLiveWrite} separates them. */
export const canWrite = (entity: McpxExposedEntity): boolean =>
	entity.write !== false;

/** The config lets MCP change live content and a draft exists to promote. */
export const canPublish = (entity: McpxExposedEntity): boolean =>
	entity.write === "live" && entity.hasDrafts;

/**
 * An upload document is a file, and no tool here carries one. Its own fields
 * stay patchable; the first version is made in the admin panel.
 */
export const canCreate = (entity: McpxExposedEntity): boolean =>
	canWrite(entity) && !entity.isUpload;

/**
 * Without drafts there is no draft stage, so every write is live.
 */
export const isLiveWrite = (entity: McpxExposedEntity): boolean =>
	entity.write === "live" && !entity.hasDrafts;

const flag = (group: unknown, name: string): boolean =>
	isPlainObject(group) && group[name] === true;

/*
 * Publishing extends writing: a key that may publish may also edit the draft it
 * publishes. Both checkboxes are required, as well as the config exposing
 * publishing.
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
	const groupOf = (name: string): unknown =>
		isPlainObject(keyCapabilities) ? keyCapabilities[name] : undefined;

	const resolveEntities = (
		entities: McpxExposedEntity[],
		namespaceGroup: unknown,
	): Record<string, McpxEntityCapabilities> => {
		const resolved: Record<string, McpxEntityCapabilities> = {};

		for (const entity of entities) {
			const group = isPlainObject(namespaceGroup)
				? namespaceGroup[entity.fieldName]
				: undefined;

			resolved[entity.slug] = {
				read: entity.read && flag(group, "read"),
				write: canWrite(entity) && flag(group, "write"),
				publish: publishFlag(entity, group),
			};
		}

		return resolved;
	};

	const toolsGroup = groupOf("tools");
	const tools: McpxResolvedCapabilities["tools"] = {};

	for (const tool of options.tools) {
		tools[tool.name] = flag(toolsGroup, tool.name);
	}

	return {
		collections: resolveEntities(options.collections, groupOf("collections")),
		globals: resolveEntities(options.globals, groupOf("globals")),
		tools,
	};
};

/**
 * The slugs tools use to narrow their enums. Taken from the output of
 * {@link resolveCapabilities}, so config and checkbox are already applied.
 */
export const scopeSlugs = (
	entries: Record<string, McpxEntityCapabilities>,
): McpxScopeSlugs => {
	const slugsWith = (operation: "publish" | "read" | "write"): string[] =>
		Object.entries(entries)
			.filter(([, value]) => value[operation])
			.map(([slug]) => slug);

	return {
		readable: slugsWith("read"),
		writable: slugsWith("write"),
		publishable: slugsWith("publish"),
	};
};
