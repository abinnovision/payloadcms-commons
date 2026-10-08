import {
	CAPABILITIES_DESCRIPTION,
	createCapabilityMatrix,
	rowOperations,
} from "./capability-matrix.js";
import { CAPABILITIES_FIELD } from "../capabilities.js";

import type { CapabilityRow } from "./capability-matrix.js";
import type { NormalizedOptions } from "../options.js";
import type {
	CheckboxField,
	Field,
	FieldHook,
	GroupField,
	Tab,
	TypeWithID,
} from "payload";

type KeyValueHook = FieldHook<TypeWithID, null | string | undefined>;

const encryptKey: KeyValueHook = ({ req, value }) =>
	typeof value === "string" ? req.payload.encrypt(value) : value;

const decryptKey: KeyValueHook = ({ req, value }) => {
	if (typeof value !== "string") {
		return value;
	}

	/*
	 * A row seeded past the encrypt hook holds no valid ciphertext; a throwing
	 * afterRead would make the whole document unreadable.
	 */
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
 * Access for fields only the server writes.
 */
export const SERVER_ONLY = {
	create: () => false,
	update: () => false,
};

// A `ui` field carries no value: its admin component renders from form state.
const adminField = (
	name: string,
	exportName: string,
	options: NormalizedOptions,
): Field => ({
	name,
	type: "ui",
	admin: {
		disableListColumn: true,
		components: {
			Field: {
				path: "@abinnovision/payloadcms-mcpx/admin",
				exportName,
				clientProps: { endpointPath: options.endpointPath },
			},
		},
	},
});

/**
 * Fields every key carries. Key generation and the HMAC index live in the
 * collection-level `beforeChange` hook (see `collection.ts`), because sibling
 * field hooks run in parallel and cannot depend on each other's values.
 */
export const createKeyFields = (): Field[] => [
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
		name: "expiresAt",
		type: "date",
		admin: {
			date: { pickerAppearance: "dayAndTime" },
			description: "Refused from this time on. Leave empty for no expiry.",
		},
	},
	{
		name: "lastUsedAt",
		type: "date",
		// Written by the default resolver only, never by a client.
		access: SERVER_ONLY,
		admin: {
			readOnly: true,
			date: { pickerAppearance: "dayAndTime" },
			description: "Updated at most once an hour.",
		},
	},
	{
		name: "apiKey",
		type: "text",
		/*
		 * Generated server-side only; a client-supplied value would replace a
		 * random secret with a chosen one.
		 */
		access: SERVER_ONLY,
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
 * The pending calls of the key, above everything else on its edit view, where
 * a collection exposes `delete`. The component renders nothing while none is
 * pending and never touches the form, so deciding does not mark the key
 * modified.
 */
export const createConfirmationFields = (
	options: NormalizedOptions,
): Field[] =>
	options.confirmations
		? [adminField("confirmations", "McpxConfirmations", options)]
		: [];

/**
 * Wraps the key fields and the capabilities in unnamed tabs, so wide tables
 * get the full form width. Named tabs would nest the data and move
 * `capabilities` off the document root, which capability resolution reads.
 */
export const withKeyTabs = (
	keyFields: Field[],
	capabilityFields: Field[],
): Field[] => {
	const tabs: Tab[] = [{ label: "Key", fields: keyFields }];

	if (capabilityFields.length > 0) {
		tabs.push({ label: "Capabilities", fields: capabilityFields });
	}

	return [{ type: "tabs", tabs }];
};

/**
 * One checkbox per operation the config exposes, grouped per collection, global
 * and custom tool, built from {@link createCapabilityMatrix}. Everything
 * defaults to off, so a key issued before a capability existed stays closed.
 *
 * An entity without drafts gets no `publish` checkbox, even where
 * writes are on: the write is already live, so the box would make `write` a
 * dead setting. The admin renders the group as a matrix; the checkboxes serve
 * consumers who replace that component through `apiKeys.overrideCollection`.
 */
export const createCapabilityFields = (options: NormalizedOptions): Field[] => {
	const matrix = createCapabilityMatrix(options);

	const entityGroups = (rows: CapabilityRow[]): GroupField[] =>
		rows.map((row) => ({
			name: row.fieldName,
			type: "group",
			label: row.slug,
			fields: rowOperations(row).map((operation) =>
				checkbox(operation.id, operation.description),
			),
		}));

	const groups = (
		[
			["collections", entityGroups(matrix.collections)],
			["globals", entityGroups(matrix.globals)],
			[
				"tools",
				matrix.tools.map((tool) => checkbox(tool.name, tool.description)),
			],
		] as const
	)
		.filter(([, fields]) => fields.length > 0)
		.map(([name, fields]): GroupField => ({ name, type: "group", fields }));

	if (groups.length === 0) {
		return [];
	}

	return [
		{
			name: CAPABILITIES_FIELD,
			type: "group",
			admin: {
				description: CAPABILITIES_DESCRIPTION,
				/*
				 * Replaces the group's own rendering only: Payload still builds form
				 * state for every nested checkbox, so the stored shape is unchanged.
				 */
				components: {
					Field: {
						path: "@abinnovision/payloadcms-mcpx/admin",
						exportName: "McpxCapabilityMatrix",
						/*
						 * `withinTab` is needed because Payload drops a group's outer
						 * border only when the group sits at a tab's edge.
						 */
						clientProps: { matrix, withinTab: true },
					},
				},
			},
			fields: groups,
		},
	];
};
