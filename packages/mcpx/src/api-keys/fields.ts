import { CAPABILITIES_FIELD } from "../capabilities.js";

import type { NormalizedOptions } from "../options.js";
import type {
	CheckboxField,
	Field,
	FieldHook,
	GroupField,
	TypeWithID,
} from "payload";

type KeyValueHook = FieldHook<TypeWithID, null | string | undefined>;

const encryptKey: KeyValueHook = ({ req, value }) =>
	typeof value === "string" ? req.payload.encrypt(value) : value;

const decryptKey: KeyValueHook = ({ req, value }) => {
	if (typeof value !== "string") {
		return value;
	}

	// A row seeded past the encrypt hook holds no valid ciphertext; a throwing
	// afterRead would make the whole document unreadable.
	try {
		return req.payload.decrypt(value);
	} catch {
		return undefined;
	}
};

const checkbox = (name: string, description: string): CheckboxField => ({
	name,
	type: "checkbox",
	defaultValue: false,
	admin: { description },
});

/**
 * Fields every key carries. Key generation and the HMAC index live in the
 * collection-level `beforeChange` hook (see `collection.ts`), because sibling
 * field hooks run in parallel and cannot depend on each other's values.
 */
const createKeyFields = (): Field[] => [
	{
		name: "label",
		type: "text",
		required: true,
		admin: { description: "What this key is used for." },
	},
	{
		name: "enabled",
		type: "checkbox",
		defaultValue: true,
		admin: {
			description: "Disabled keys are refused without revoking them.",
		},
	},
	{
		name: "apiKey",
		type: "text",
		// Generated server-side only; a client-supplied value would replace a
		// random secret with a chosen one.
		access: {
			create: () => false,
			update: () => false,
		},
		admin: {
			readOnly: true,
			description:
				"Generated when the key is created. Send it as `Authorization: Bearer <key>`.",
		},
		hooks: {
			beforeChange: [encryptKey],
			afterRead: [decryptKey],
		},
	},
	{
		name: "apiKeyIndex",
		type: "text",
		hidden: true,
		index: true,
	},
];

/**
 * One checkbox per exposed operation, grouped per collection and per custom
 * tool. Only operations the plugin config exposes get a checkbox, so a key can
 * never enable more than the config allows. Everything defaults to off.
 */
const createCapabilityFields = (options: NormalizedOptions): Field[] => {
	const collectionGroups: GroupField[] = options.collections.map(
		(collection) => ({
			name: collection.fieldName,
			type: "group",
			label: collection.slug,
			fields: [
				...(collection.read
					? [checkbox("read", "Describe, find and read documents.")]
					: []),
				...(collection.write
					? [checkbox("write", "Create, patch and validate drafts.")]
					: []),
			],
		}),
	);

	const toolCheckboxes: CheckboxField[] = options.tools.map((tool) =>
		checkbox(tool.name, tool.description),
	);

	const groups: GroupField[] = [
		...(collectionGroups.length > 0
			? [
					{
						name: "collections",
						type: "group" as const,
						fields: collectionGroups,
					},
				]
			: []),
		...(toolCheckboxes.length > 0
			? [{ name: "tools", type: "group" as const, fields: toolCheckboxes }]
			: []),
	];

	if (groups.length === 0) {
		return [];
	}

	return [
		{
			name: CAPABILITIES_FIELD,
			type: "group",
			admin: {
				description:
					"What this key may do. Unchecked means refused, whatever the plugin config allows.",
			},
			fields: groups,
		},
	];
};

export { createCapabilityFields, createKeyFields };
