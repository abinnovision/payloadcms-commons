import {
	buildConfig,
	createPayloadRequest,
	getPayload,
	handleEndpoints,
} from "payload";

import { startSidecar } from "./sidecar.js";
import { capabilityFields } from "../../../src/keys/augment.js";
import { ensureAgentKey } from "../../../src/keys/manager.js";
import {
	EDITOR,
	fixtureConfig,
	SIDECAR_SECRET,
} from "../../fixtures/config.js";

import type { FakeSidecar } from "./sidecar.js";
import type { FluePluginOptions } from "../../../src/index.js";
import type { KeySettings } from "../../../src/keys/manager.js";
import type { Payload, SanitizedConfig, Where } from "payload";

export const API_KEYS_SLUG = "mcpx-api-keys";
export const THREADS_SLUG = "flue-threads";

/** The submission the recordings settle. */
export const RECORDED_SUBMISSION = "sub_01M6VB02GCSHGD7X1Z5829HF5Q";

export type Doc = Record<string, unknown> & { id: number | string };

const KEY_TTL_MS = 2 * 60 * 60 * 1000;

export const USERS = {
	first: { email: "first@example.com", password: "first-secret" },
	second: { email: "second@example.com", password: "second-secret" },
	admin: { email: "admin@example.com", password: "admin-secret" },
};

export interface Booted {
	config: Promise<SanitizedConfig>;
	payload: Payload;
	/** Shared by `getPayload` and `handleEndpoints`, so both reach this instance. */
	cacheKey: string;
	sidecar: FakeSidecar;
}

/**
 * Starts a fake sidecar and boots the fixture against it, with `flue`
 * replacing flue's options key by key. `getPayload` caches by key, so every
 * spec passes its own.
 */
export const bootPayload = async (
	cacheKey: string,
	flue?: Partial<FluePluginOptions>,
): Promise<Booted> => {
	const sidecar = await startSidecar();
	const config = buildConfig(
		fixtureConfig({ sidecarUrl: sidecar.url, ...(flue ? { flue } : {}) }),
	);
	const payload = await getPayload({ config, key: cacheKey });

	return { config, payload, cacheKey, sidecar };
};

export const shutdown = async (booted: Booted): Promise<void> => {
	await booted.payload.destroy();
	await booted.sidecar.close();
};

export interface SeededUser {
	id: number | string;
	/** A session token, sent as `Authorization: JWT <token>`. */
	token: string;
}

export interface Seeded {
	/** Has `agentAccess`, so `restricted` and agent runs admit them. */
	first: SeededUser;
	second: SeededUser;
	/** An `admins` user whose id equals `first`'s. */
	admin: SeededUser;
}

export const login = async (
	payload: Payload,
	collection: "admins" | "users",
	data: { email: string; password: string },
): Promise<string> => {
	const { token } = await payload.login({ collection, data });

	if (token === undefined) {
		throw new Error(`No token for ${data.email}.`);
	}

	return token;
};

/** Creates the users of {@link USERS} and signs each in. */
export const seed = async (payload: Payload): Promise<Seeded> => {
	const create = (collection: "admins" | "users", data: object) =>
		payload.create({ collection, data, overrideAccess: true });
	const first = await create("users", { ...USERS.first, agentAccess: true });
	const second = await create("users", USERS.second);
	const admin = await create("admins", USERS.admin);

	if (String(admin.id) !== String(first.id)) {
		throw new Error(
			"The seed relies on colliding ids across auth collections.",
		);
	}

	return {
		first: { id: first.id, token: await login(payload, "users", USERS.first) },
		second: {
			id: second.id,
			token: await login(payload, "users", USERS.second),
		},
		admin: { id: admin.id, token: await login(payload, "admins", USERS.admin) },
	};
};

/**
 * Sends one request through Payload's router, the path a Next.js route
 * handler takes. A `token` signs it in; a `body` is sent as JSON unless it
 * is a string; `headers` come last; `signal` stands for the client going away.
 */
export const send = (
	booted: Booted,
	path: string,
	args: {
		method?: string;
		token?: string;
		body?: unknown;
		headers?: Record<string, string>;
		signal?: AbortSignal;
	} = {},
): Promise<Response> =>
	handleEndpoints({
		config: booted.config,
		payloadInstanceCacheKey: booted.cacheKey,
		request: new Request(`http://localhost${path}`, {
			method: args.method ?? "GET",
			headers: {
				...(args.body === undefined
					? {}
					: { "content-type": "application/json" }),
				...(args.token === undefined
					? {}
					: { authorization: `JWT ${args.token}` }),
				...args.headers,
			},
			...(args.signal === undefined ? {} : { signal: args.signal }),
			...(args.body === undefined
				? {}
				: {
						body:
							typeof args.body === "string"
								? args.body
								: JSON.stringify(args.body),
					}),
		}),
	});

/** `POST /api/flue/exchange` as the sidecar, with the shared secret by default. */
export const exchange = (
	booted: Booted,
	body: unknown,
	authorization = `Bearer ${SIDECAR_SECRET}`,
): Promise<Response> =>
	send(booted, "/api/flue/exchange", {
		method: "POST",
		body,
		headers: { authorization },
	});

let nextRpcId = 0;

/** One JSON-RPC request to mcpx as the bearer of `key`. */
export const mcpRpc = async (
	booted: Booted,
	key: string,
	method: string,
	params?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> => {
	const response = await handleEndpoints({
		config: booted.config,
		payloadInstanceCacheKey: booted.cacheKey,
		request: new Request("http://localhost/api/mcpx", {
			method: "POST",
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
				authorization: `Bearer ${key}`,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: ++nextRpcId,
				method,
				params,
			}),
		}),
	});

	return {
		status: response.status,
		body: (await response.json()) as Record<string, unknown>,
	};
};

/** The settings key management runs with, as the plugin derives them. */
export const keySettings = (payload: Payload): KeySettings => ({
	keyTtlMs: KEY_TTL_MS,
	mcpx: { apiKeysSlug: API_KEYS_SLUG },
	capabilityMap: capabilityFields(payload.collections[API_KEYS_SLUG]!.config),
});

/** A thread row past access control, hidden fields included. */
export const stored = async (
	booted: Booted,
	id: number | string,
): Promise<Doc> =>
	await booted.payload.findByID({
		collection: THREADS_SLUG,
		id,
		depth: 0,
		overrideAccess: true,
		showHiddenFields: true,
	});

/** The documents of `collection` that match `where`, past access control. */
export const count = async (
	booted: Booted,
	collection: string,
	where: Where = {},
): Promise<number> =>
	(await booted.payload.count({ collection, where, overrideAccess: true }))
		.totalDocs;

/** Enables the user's managed key for `EDITOR`, as a turn does, and returns its id. */
export const enableEditorKey = async (
	booted: Booted,
	userId: number | string,
): Promise<number | string> =>
	(
		await ensureAgentKey(booted.payload, keySettings(booted.payload), {
			userId,
			agent: EDITOR,
			req: await createPayloadRequest({ payload: booted.payload }),
		})
	).id;

/** Whether the managed key is enabled, read past the locks. */
export const keyEnabled = async (
	booted: Booted,
	apiKeyId: number | string,
): Promise<boolean> =>
	(
		await booted.payload.findByID({
			collection: API_KEYS_SLUG,
			id: apiKeyId,
			depth: 0,
			overrideAccess: true,
			select: { enabled: true },
		})
	)["enabled"] === true;
