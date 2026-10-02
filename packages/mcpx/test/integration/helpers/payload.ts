import { getPayload } from "payload";

import { buildFixtureConfig } from "../../fixtures/config.js";

import type { McpxPluginOptions } from "../../../src/index.js";
import type {
	CollectionConfig,
	DatabaseAdapterObj,
	Payload,
	SanitizedConfig,
} from "payload";

const DEFAULT_CACHE_KEY = "mcpx-integration";

export const API_KEYS_SLUG = "mcpx-api-keys";

export const USER = { email: "mcpx@example.com", password: "mcpx-secret" };

export interface Booted {
	config: Promise<SanitizedConfig>;
	payload: Payload;
	/** Shared by `getPayload` and `handleEndpoints`, so both reach this instance. */
	cacheKey: string;
}

/**
 * `getPayload` caches by `key`, so a spec that boots a different plugin config
 * must pass its own or it silently reuses the default instance.
 */
export const bootPayload = async (
	args: {
		key?: string;
		plugin?: Partial<McpxPluginOptions>;
		users?: CollectionConfig;
		collections?: CollectionConfig[];
		db?: DatabaseAdapterObj;
	} = {},
): Promise<Booted> => {
	const cacheKey = args.key ?? DEFAULT_CACHE_KEY;
	const config = buildFixtureConfig({
		...(args.plugin === undefined ? {} : { plugin: args.plugin }),
		...(args.users === undefined ? {} : { users: args.users }),
		...(args.collections === undefined
			? {}
			: { collections: args.collections }),
		...(args.db === undefined ? {} : { db: args.db }),
	});
	const payload = await getPayload({ config, key: cacheKey });

	return { config, payload, cacheKey };
};

interface EntityCapabilities {
	read?: boolean;
	write?: boolean;
	publish?: boolean;
}

export interface KeyCapabilities {
	collections?: Record<string, EntityCapabilities>;
	globals?: Record<string, EntityCapabilities>;
	tools?: Record<string, boolean>;
}

/**
 * Creates a key for `userId` and returns its plaintext, which `afterRead`
 * decrypts on the created document.
 */
export const createKey = async (
	payload: Payload,
	args: {
		userId: number | string;
		label: string;
		capabilities: KeyCapabilities;
		enabled?: boolean;
	},
): Promise<string> => {
	const doc = (await payload.create({
		collection: API_KEYS_SLUG as never,
		data: {
			label: args.label,
			user: args.userId,
			enabled: args.enabled ?? true,
			capabilities: args.capabilities,
		},
		overrideAccess: true,
	})) as unknown as { apiKey: string };

	return doc.apiKey;
};

/** Creates {@link USER} and one key per entry, labelled with the entry's name. */
export const seedKeysFor = async <Label extends string>(
	payload: Payload,
	capabilities: Record<Label, KeyCapabilities>,
): Promise<{ userId: number | string; keys: Record<Label, string> }> => {
	const user = await payload.create({ collection: "users", data: USER });
	const keys: Partial<Record<Label, string>> = {};

	for (const [label, granted] of Object.entries(capabilities) as [
		Label,
		KeyCapabilities,
	][]) {
		keys[label] = await createKey(payload, {
			userId: user.id,
			label,
			capabilities: granted,
		});
	}

	return { userId: user.id, keys: keys as Record<Label, string> };
};

export const FULL_CAPABILITIES: KeyCapabilities = {
	collections: {
		pages: { read: true, write: true },
		posts: { read: true, write: true },
		tags: { read: true },
	},
	tools: { echo: true, whichCollection: true },
};

export interface Seeded {
	userId: number | string;
	keys: {
		full: string;
		readOnly: string;
		tagsOnly: string;
		disabled: string;
	};
}

/** The keys the specs on the default plugin config share. */
export const seedKeys = async (payload: Payload): Promise<Seeded> => {
	const { userId, keys } = await seedKeysFor(payload, {
		full: FULL_CAPABILITIES,
		readOnly: {
			collections: {
				pages: { read: true },
				posts: { read: true },
				tags: { read: true },
			},
		},
		tagsOnly: { collections: { tags: { read: true } } },
	});
	const disabled = await createKey(payload, {
		userId,
		label: "disabled",
		capabilities: FULL_CAPABILITIES,
		enabled: false,
	});

	return { userId, keys: { ...keys, disabled } };
};

/** Creates an English draft through the Local API, bypassing the endpoint. */
export const createDraft = <Doc>(
	payload: Payload,
	collection: "pages" | "posts",
	data: Record<string, unknown>,
): Promise<Doc> =>
	payload.create({
		collection,
		locale: "en",
		draft: true,
		data,
	}) as Promise<Doc>;

/** The latest draft in one locale, without falling back to another. */
export const readDraft = <Doc>(
	payload: Payload,
	collection: "pages" | "posts",
	id: number | string,
	locale = "en",
): Promise<Doc> =>
	payload.findByID({
		collection,
		id,
		depth: 0,
		draft: true,
		locale,
		fallbackLocale: false,
	}) as Promise<Doc>;

/** A one-pixel PNG, so a real file lands on disk without needing sharp. */
const PIXEL = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

/** Uploads a one-pixel image as a `media` document. */
export const createMedia = (
	payload: Payload,
	alt: string,
): Promise<{ id: number | string }> =>
	payload.create({
		collection: "media" as never,
		data: { alt },
		file: {
			data: PIXEL,
			mimetype: "image/png",
			name: "pixel.png",
			size: PIXEL.length,
		},
		overrideAccess: true,
	});
