import { GRANTS, MANAGED_BY } from "./augment.js";
import { isRecord } from "../protocol/guards.js";
import { isId } from "../protocol/owner.js";

import type { CapabilityFieldMap } from "./augment.js";
import type { McpxSettings } from "../options.js";
import type { FlueAgentConfig, FlueCapabilities } from "../types.js";
import type {
	DefaultDocumentIDType,
	Payload,
	PayloadRequest,
	Where,
	WhereField,
} from "payload";

/** What key management reads from the plugin's settings. */
export interface KeySettings {
	keyTtlMs: number;
	mcpx: Pick<McpxSettings, "apiKeysSlug">;
	capabilityMap: CapabilityFieldMap;
}

/** A managed key as {@link findAgentKey} returns it. */
export interface AgentKey {
	id: DefaultDocumentIDType;
	apiKey: string | undefined;
	enabled: boolean;
	expiresAt: string | undefined;
	user: DefaultDocumentIDType | undefined;
	managedBy: string | undefined;
}

type KeyDoc = Record<string, unknown> & { id: DefaultDocumentIDType };

/** The `managedBy` value of the key flue manages for `agent`. */
export const managedMarker = (agent: string): string => `flue:${agent}`;

const optionalString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

/*
 * Every checkbox mcpx offers, ticked only where granted, so the key carries
 * exactly the agent's capabilities whatever was edited on it before. A grant
 * never ticks `deleteUnattended`: every delete goes through approval.
 */
const keyCapabilities = (
	map: CapabilityFieldMap,
	capabilities: FlueCapabilities,
): Record<string, Record<string, unknown>> => {
	const entities = (namespace: "collections" | "globals") =>
		Object.fromEntries(
			Object.entries(map[namespace]).map(([slug, { field, operations }]) => {
				const grant = capabilities[namespace]?.[slug] as
					Record<string, boolean | undefined> | undefined;

				return [
					field,
					Object.fromEntries(
						operations.map((operation) => [
							operation,
							GRANTS.some((name) => name === operation) &&
								grant?.[operation] === true,
						]),
					),
				];
			}),
		);

	return {
		collections: entities("collections"),
		globals: entities("globals"),
		tools: Object.fromEntries(
			map.tools.map((name) => [name, capabilities.tools?.[name] === true]),
		),
	};
};

/**
 * Whether `stored` grants exactly what `wanted` grants. Only the wanted shape
 * is walked. A stored checkbox grants when it is `true`, so `null` matches
 * `false`; a missing group differs unless the wanted group is empty.
 */
export const sameCapabilities = (
	stored: unknown,
	wanted: Record<string, unknown>,
): boolean =>
	Object.entries(wanted).every(([name, value]) => {
		const current = isRecord(stored) ? stored[name] : undefined;

		if (!isRecord(value)) {
			return (current === true) === value;
		}

		return isRecord(current)
			? sameCapabilities(current, value)
			: Object.keys(value).length === 0;
	});

const managedKeysOf = (
	userId: DefaultDocumentIDType,
	marker: WhereField,
): Where => ({
	and: [{ user: { equals: userId } }, { [MANAGED_BY]: marker }],
});

const updateKeys = async (
	payload: Payload,
	settings: Pick<KeySettings, "mcpx">,
	where: Where,
	data: Record<string, unknown>,
	req: PayloadRequest,
): Promise<void> => {
	const { errors } = await payload.update({
		collection: settings.mcpx.apiKeysSlug,
		where,
		data,
		depth: 0,
		overrideAccess: true,
		req,
	});

	if (errors.length > 0) {
		throw new Error(
			`[payloadcms-flue] Could not update ${String(errors.length)} managed mcpx key(s).`,
		);
	}
};

/**
 * The key of (`userId`, `agent`), created on first use. A call writes only
 * when the key is disabled, has half of `keyTtlMs` or less left or more than
 * `keyTtlMs`, or carries other capabilities than the agent's; the write
 * enables it, rolls its expiry to now plus `keyTtlMs` and resets its
 * capabilities to the agent's.
 * Concurrent first calls may create two; the oldest is used.
 */
export const ensureAgentKey = async (
	payload: Payload,
	settings: KeySettings,
	args: {
		userId: DefaultDocumentIDType;
		agent: FlueAgentConfig;
		req: PayloadRequest;
	},
): Promise<{ id: DefaultDocumentIDType; expiresAt: string }> => {
	const { userId, agent, req } = args;
	const collection = settings.mcpx.apiKeysSlug;
	const marker = managedMarker(agent.slug);
	const now = Date.now();
	const expiresAt = new Date(now + settings.keyTtlMs).toISOString();
	const data = {
		enabled: true,
		expiresAt,
		capabilities: keyCapabilities(settings.capabilityMap, agent.capabilities),
	};

	const { docs } = await payload.find({
		collection,
		where: managedKeysOf(userId, { equals: marker }),
		sort: ["createdAt", "id"],
		limit: 1,
		depth: 0,
		overrideAccess: true,
		select: { enabled: true, expiresAt: true, capabilities: true },
		req,
	});
	const existing = docs[0] as KeyDoc | undefined;

	if (existing) {
		const storedExpiry = optionalString(existing["expiresAt"]);
		const remaining = Date.parse(storedExpiry ?? "") - now;

		if (
			existing["enabled"] === true &&
			storedExpiry !== undefined &&
			remaining > settings.keyTtlMs / 2 &&
			remaining <= settings.keyTtlMs &&
			sameCapabilities(existing["capabilities"], data.capabilities)
		) {
			return { id: existing.id, expiresAt: storedExpiry };
		}

		await payload.update({
			collection,
			id: existing.id,
			data,
			depth: 0,
			overrideAccess: true,
			select: { id: true },
			req,
		});

		return { id: existing.id, expiresAt };
	}

	const created = (await payload.create({
		collection,
		data: {
			...data,
			label: `Flue: ${agent.label ?? agent.slug}`,
			user: userId,
			[MANAGED_BY]: marker,
		},
		depth: 0,
		overrideAccess: true,
		select: { id: true },
		req,
	})) as KeyDoc;

	return { id: created.id, expiresAt };
};

/**
 * The key of (`userId`, `agent`) with its plaintext, read past access
 * control, or `undefined`. Of two keys the oldest is the one
 * {@link ensureAgentKey} maintains.
 */
export const findAgentKey = async (
	payload: Payload,
	settings: Pick<KeySettings, "mcpx">,
	args: { userId: DefaultDocumentIDType; agent: string },
): Promise<AgentKey | undefined> => {
	const { docs } = await payload.find({
		collection: settings.mcpx.apiKeysSlug,
		where: managedKeysOf(args.userId, { equals: managedMarker(args.agent) }),
		sort: ["createdAt", "id"],
		limit: 1,
		depth: 0,
		overrideAccess: true,
		select: {
			apiKey: true,
			enabled: true,
			expiresAt: true,
			user: true,
			[MANAGED_BY]: true,
		},
	});
	const doc = docs[0] as KeyDoc | undefined;

	if (!doc) {
		return undefined;
	}

	return {
		id: doc.id,
		apiKey: optionalString(doc["apiKey"]),
		enabled: doc["enabled"] === true,
		expiresAt: optionalString(doc["expiresAt"]),
		user: isId(doc["user"]) ? doc["user"] : undefined,
		managedBy: optionalString(doc[MANAGED_BY]),
	};
};

/** Enables or disables the key of (`userId`, `agent`). */
export const setAgentKeyEnabled = (
	payload: Payload,
	settings: Pick<KeySettings, "mcpx">,
	args: {
		userId: DefaultDocumentIDType;
		agent: string;
		enabled: boolean;
		req: PayloadRequest;
	},
): Promise<void> =>
	updateKeys(
		payload,
		settings,
		managedKeysOf(args.userId, { equals: managedMarker(args.agent) }),
		{ enabled: args.enabled },
		args.req,
	);

/** Disables every managed key of `userId`. */
export const disableUserKeys = (
	payload: Payload,
	settings: Pick<KeySettings, "mcpx">,
	args: { userId: DefaultDocumentIDType; req: PayloadRequest },
): Promise<void> =>
	updateKeys(
		payload,
		settings,
		managedKeysOf(args.userId, { exists: true }),
		{ enabled: false },
		args.req,
	);
