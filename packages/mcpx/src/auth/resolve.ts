import { hashApiKey } from "../api-keys/index.js";

import type { NormalizedOptions } from "../options.js";
import type { McpxAuthResult } from "../types.js";
import type { PayloadRequest } from "payload";

const BEARER = /^Bearer\s+(\S+)\s*$/i;

const relationId = (value: unknown): number | string | undefined => {
	if (typeof value === "string" || typeof value === "number") {
		return value;
	}

	if (typeof value === "object" && value !== null && "id" in value) {
		return (value as { id: number | string }).id;
	}

	return undefined;
};

export const parseBearer = (headers: Headers): null | string => {
	const header = headers.get("authorization");

	if (!header) {
		return null;
	}

	return BEARER.exec(header.trim())?.[1] ?? null;
};

/**
 * Resolves the bearer key of a request to the user it acts as.
 *
 * The key is looked up by its HMAC index, the same way Payload resolves its own
 * API keys. A missing, unknown, disabled or orphaned key yields `null`; nothing
 * here throws, so the handler alone decides how a refusal looks.
 */
export const resolveApiKeyAuth = async (
	req: PayloadRequest,
	options: NormalizedOptions,
): Promise<McpxAuthResult | null> => {
	const key = parseBearer(req.headers);
	if (key === null) {
		return null;
	}

	const { payload } = req;
	const { docs } = await payload.find({
		collection: options.apiKeysSlug,
		where: { apiKeyIndex: { equals: hashApiKey(payload.secret, key) } },
		limit: 1,
		pagination: false,
		depth: 0,
		overrideAccess: true,
		select: { enabled: true, user: true, capabilities: true },
	});

	const keyDoc = docs[0] as
		| {
				id: number | string;
				enabled?: boolean;
				user?: unknown;
				capabilities?: unknown;
		  }
		| undefined;
	const userId = relationId(keyDoc?.user);

	if (!keyDoc || keyDoc.enabled !== true || userId === undefined) {
		return null;
	}

	const userCollection = payload.collections[options.userCollection];
	const user = await payload.findByID({
		collection: options.userCollection,
		id: userId,
		depth: userCollection?.config.auth.depth ?? 0,
		overrideAccess: true,
		disableErrors: true,
	});

	const lockUntil =
		typeof user?.["lockUntil"] === "string"
			? Date.parse(user["lockUntil"])
			: Number.NaN;

	if (!user || user["_verified"] === false || lockUntil > Date.now()) {
		return null;
	}

	return {
		user: {
			...user,
			collection: options.userCollection,
			_strategy: "mcpx-api-key",
		},
		apiKeyId: keyDoc.id,
		capabilities: keyDoc.capabilities,
	};
};
