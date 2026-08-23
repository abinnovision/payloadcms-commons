import { createCapabilityFields, createKeyFields } from "./fields.js";
import { generateApiKey, hashApiKey } from "./key.js";

import type { NormalizedOptions } from "../options.js";
import type {
	Access,
	CollectionBeforeChangeHook,
	CollectionConfig,
	PayloadRequest,
} from "payload";

/**
 * Generates the key on create and keeps the lookup index in step with it.
 * Runs after field `beforeValidate` fallbacks, so on update `data.apiKey` is the
 * decrypted plaintext of the stored key.
 */
const keyBeforeChange: CollectionBeforeChangeHook = ({
	data,
	operation,
	req,
}) => {
	if (operation === "create" && typeof data["apiKey"] !== "string") {
		data["apiKey"] = generateApiKey();
	}

	if (typeof data["apiKey"] === "string") {
		data["apiKeyIndex"] = hashApiKey(req.payload.secret, data["apiKey"]);
	}

	return data;
};

/**
 * The collection holding MCP API keys. It is not an auth collection on
 * purpose: keys must only ever authenticate the MCP endpoint, never the REST
 * or GraphQL API.
 */
const createApiKeysCollection = (
	options: NormalizedOptions,
): CollectionConfig => {
	const { userCollection } = options;

	const isUser = ({ req }: { req: PayloadRequest }): boolean =>
		Boolean(req.user && req.user.collection === userCollection);

	const ownKeysOnly: Access = ({ req }) =>
		isUser({ req }) && req.user ? { user: { equals: req.user.id } } : false;

	return {
		slug: options.apiKeysSlug,
		labels: { singular: "API Key", plural: "API Keys" },
		admin: {
			group: "MCP",
			useAsTitle: "label",
			description:
				"Keys for MCP clients. Each key acts as its user and may only do what its capabilities allow.",
		},
		access: {
			create: isUser,
			read: ownKeysOnly,
			update: ownKeysOnly,
			delete: ownKeysOnly,
		},
		hooks: {
			beforeChange: [keyBeforeChange],
		},
		fields: [
			{
				name: "user",
				type: "relationship",
				relationTo: userCollection,
				required: true,
				access: {
					create: () => false,
					update: () => false,
				},
				defaultValue: ({ req }: { req: PayloadRequest }) =>
					isUser({ req }) ? req.user?.id : undefined,
				admin: {
					description: "The user this key acts as.",
				},
			},
			...createKeyFields(),
			...createCapabilityFields(options),
		],
	};
};

export { createApiKeysCollection, keyBeforeChange };
