import { getPayload } from "payload";

import { buildFixtureConfig } from "../../fixtures/config.js";

import type { Payload, SanitizedConfig } from "payload";

/** Cache key shared by `getPayload` and `handleEndpoints` within one file. */
export const CACHE_KEY = "mcpx-integration";

export const API_KEYS_SLUG = "mcpx-api-keys";

export const USER = { email: "mcpx@example.com", password: "mcpx-secret" };

export interface Booted {
	config: Promise<SanitizedConfig>;
	payload: Payload;
}

export const bootPayload = async (): Promise<Booted> => {
	const config = buildFixtureConfig();
	const payload = await getPayload({ config, key: CACHE_KEY });

	return { config, payload };
};

export interface KeyCapabilities {
	collections?: Record<string, { read?: boolean; write?: boolean }>;
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

export const FULL_CAPABILITIES: KeyCapabilities = {
	collections: {
		pages: { read: true, write: true },
		posts: { read: true, write: true },
		tags: { read: true },
	},
	tools: { echo: true },
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

export const seedKeys = async (payload: Payload): Promise<Seeded> => {
	const user = await payload.create({
		collection: "users",
		data: USER,
	});

	const keys = {
		full: await createKey(payload, {
			userId: user.id,
			label: "full",
			capabilities: FULL_CAPABILITIES,
		}),
		readOnly: await createKey(payload, {
			userId: user.id,
			label: "read-only",
			capabilities: {
				collections: {
					pages: { read: true },
					posts: { read: true },
					tags: { read: true },
				},
			},
		}),
		tagsOnly: await createKey(payload, {
			userId: user.id,
			label: "tags-only",
			capabilities: { collections: { tags: { read: true } } },
		}),
		disabled: await createKey(payload, {
			userId: user.id,
			label: "disabled",
			capabilities: FULL_CAPABILITIES,
			enabled: false,
		}),
	};

	return { userId: user.id, keys };
};

/** A minimal Lexical editor state with one paragraph. */
export const paragraph = (text: string): Record<string, unknown> => ({
	root: {
		type: "root",
		version: 1,
		direction: null,
		format: "",
		indent: 0,
		children: [
			{
				type: "paragraph",
				version: 1,
				children: [{ type: "text", version: 1, text }],
			},
		],
	},
});

/** A hero module block, as stored in a section wrapper's `modules`. */
export const hero = (title: string): Record<string, unknown> => ({
	blockType: "hero",
	title: paragraph(title),
});

/** A section wrapper block holding the given modules. */
export const section = (
	identifier: string,
	modules: Record<string, unknown>[] = [],
): Record<string, unknown> => ({
	blockType: "sectionWrapper",
	identifier,
	modules,
});
