import { isPlainObject } from "./guards.js";

import type { NormalizedOptions } from "./options.js";
import type {
	McpxEntityCapabilities,
	McpxExposedEntity,
	McpxResolvedCapabilities,
	McpxScopeSlugs,
} from "./types.js";

/**
 * Group field holding the capability checkboxes on an API key document.
 */
export const CAPABILITIES_FIELD = "capabilities";

/**
 * The operations a collection or global can expose. The generated checkboxes
 * and the matrix segments share this wording. `requires` names the
 * operation a grant depends on, which the server and the matrix both enforce.
 */
export const CAPABILITY_OPERATIONS = [
	{ id: "read", label: "Read", description: "Describe, find and read." },
	{
		id: "write",
		label: "Write",
		description: "Create, patch and validate drafts.",
		requires: "read",
	},
	{
		id: "publish",
		label: "Publish",
		description: "Promote the current draft to what the public sees.",
		requires: "write",
	},
	{
		id: "delete",
		label: "Delete",
		description:
			"Delete documents. Each one is approved by this key's user in the admin panel, unless the config allows trashing directly and this key is set to.",
		requires: "read",
	},
] as const;

/**
 * Stored as a checkbox of its own but drawn as the approval shield of the Delete
 * control.
 */
const DELETE_UNATTENDED = {
	id: "deleteUnattended",
	label: "Trash directly",
	description: "Move documents to trash without asking this key's user.",
	requires: "delete",
} as const;

/**
 * Every operation with a stored checkbox: the capability operations plus
 * the unattended delete. Each follows the one it requires, which the resolve
 * loop depends on.
 */
export const STORED_OPERATIONS = [
	...CAPABILITY_OPERATIONS,
	DELETE_UNATTENDED,
] as const;

export type StoredOperation = (typeof STORED_OPERATIONS)[number]["id"];

/**
 * The operations in one run of the access levels, each requiring the one
 * before it. Delete is chosen separately.
 */
export const ACCESS_CHAIN = CAPABILITY_OPERATIONS.filter(
	(operation) => operation.id !== "delete",
);

/**
 * What an operation depends on. `resolveCapabilities` discards a grant whose
 * prerequisite is off.
 */
export const requiresOf = (
	operation: StoredOperation,
): StoredOperation | undefined => {
	const found = STORED_OPERATIONS.find(
		(candidate) => candidate.id === operation,
	);

	return found && "requires" in found ? found.requires : undefined;
};

const flag = (group: unknown, name: string): boolean =>
	isPlainObject(group) && group[name] === true;

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

			/*
			 * Writing extends reading: a write-only key could not learn the schema or
			 * find an id, and its patch errors would leak what it may not read. Each
			 * operation also needs the one it `requires`, so publishing needs
			 * writing and deleting needs reading. The config must expose the
			 * operation and the key must tick its checkbox.
			 */
			const granted: McpxEntityCapabilities = {
				read: false,
				write: false,
				publish: false,
				delete: false,
				deleteUnattended: false,
			};

			for (const { id } of STORED_OPERATIONS) {
				const needs = requiresOf(id);

				granted[id] =
					entity[id] &&
					flag(group, id) &&
					(needs === undefined || granted[needs]);
			}

			resolved[entity.slug] = granted;
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
	const slugsWith = (operation: StoredOperation): string[] =>
		Object.entries(entries)
			.filter(([, value]) => value[operation])
			.map(([slug]) => slug);

	return {
		readable: slugsWith("read"),
		writable: slugsWith("write"),
		publishable: slugsWith("publish"),
		deletable: slugsWith("delete"),
	};
};
