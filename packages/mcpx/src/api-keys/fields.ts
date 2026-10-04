import {
	CAPABILITIES_DESCRIPTION,
	STORED_OPERATIONS,
	createCapabilityMatrix,
} from "./capability-matrix.js";
import { CAPABILITIES_FIELD } from "../capabilities.js";

import type { CapabilityRow } from "./capability-matrix.js";
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

// Name of the `ui` field the "Connect a client" tab renders.
const SETUP_GUIDE_FIELD = "setupGuide";

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
		access: {
			create: () => false,
			update: () => false,
		},
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
 * The pending calls of the key, above everything else on its edit view, where
 * a collection exposes `delete`. The component renders nothing while none is
 * pending and never touches the form, so deciding does not mark the key
 * modified.
 */
export const createConfirmationFields = (
	options: NormalizedOptions,
): Field[] =>
	options.confirmations
		? [
				{
					name: "confirmations",
					type: "ui",
					admin: {
						disableListColumn: true,
						components: {
							Field: {
								path: "@abinnovision/payloadcms-mcpx/admin",
								exportName: "McpxConfirmations",
								clientProps: { endpointPath: options.endpointPath },
							},
						},
					},
				},
			]
		: [];

/**
 * Wraps the key fields and the setup guide in unnamed tabs, so wide snippets
 * get the full form width. Named tabs would nest the data and move
 * `capabilities` off the document root, which capability resolution reads.
 *
 * The guide tab only shows on update: on create there is no key to hand out.
 */
export const withSetupGuideTab = (
	keyFields: Field[],
	options: NormalizedOptions,
): Field[] => {
	if (!options.setupGuide) {
		return keyFields;
	}

	return [
		{
			type: "tabs",
			tabs: [
				{ label: "Key", fields: keyFields },
				{
					label: "Connect a client",
					admin: {
						condition: (_data, _siblingData, { operation }) =>
							operation === "update",
					},
					fields: [
						{
							name: SETUP_GUIDE_FIELD,
							/*
							 * A `ui` field carries no value: the component builds every
							 * snippet client-side from form state and the admin config.
							 */
							type: "ui",
							admin: {
								disableListColumn: true,
								components: {
									Field: {
										path: "@abinnovision/payloadcms-mcpx/admin",
										exportName: "McpxSetupGuide",
										clientProps: { endpointPath: options.endpointPath },
									},
								},
							},
						},
					],
				},
			],
		},
	];
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
			label: row.label,
			fields: STORED_OPERATIONS.filter((operation) => row[operation.id]).map(
				(operation) => checkbox(operation.id, operation.description),
			),
		}));

	const collectionGroups = entityGroups(matrix.collections);
	const globalGroups = entityGroups(matrix.globals);
	const toolCheckboxes: CheckboxField[] = matrix.tools.map((tool) =>
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
		...(globalGroups.length > 0
			? [
					{
						name: "globals",
						type: "group" as const,
						fields: globalGroups,
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
						clientProps: { matrix, withinTab: options.setupGuide },
					},
				},
			},
			fields: groups,
		},
	];
};
