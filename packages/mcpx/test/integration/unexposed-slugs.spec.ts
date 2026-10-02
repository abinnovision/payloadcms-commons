import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool } from "./helpers/mcp.js";
import { API_KEYS_SLUG, bootPayload, createKey } from "./helpers/payload.js";

import type { CallResult } from "./helpers/mcp.js";
import type { Booted, KeyCapabilities } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-unexposed";

const NOTE_TITLE = "unexposed note title";
const USER_EMAIL = "unexposed-owner@example.com";
const KEY_LABEL = "unexposed key label";

const FULL: KeyCapabilities = {
	collections: {
		pages: { read: true, write: true, publish: true },
		posts: { read: true, write: true },
		tags: { read: true },
	},
};

/*
 * What a document store without a fixed schema could hold on the key: entries
 * for slugs the config never exposed, under both the slug and its field name.
 */
const FORGED_ENTRY = { read: true, write: true, publish: true };
const FORGED_COLLECTIONS = {
	notes: FORGED_ENTRY,
	users: FORGED_ENTRY,
	[API_KEYS_SLUG]: FORGED_ENTRY,
	mcpxApiKeys: FORGED_ENTRY,
};

const refused = (result: CallResult): boolean =>
	result.isError || result.rpcError !== undefined;

const responseText = (result: CallResult): string =>
	`${result.text ?? ""} ${result.rpcError?.message ?? ""}`;

describe("collections the config does not expose", () => {
	let booted: Booted;
	let plainKey: string;
	let forgedKey: string;
	let forgedKeyId: number | string | undefined;
	let targets: Record<string, number | string>;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				collections: {
					pages: { read: true, write: "live" },
					posts: { read: true, write: "draft" },
					tags: true,
				},
				auth: {
					resolve: async ({ resolveDefault }) => {
						const auth = await resolveDefault();

						if (!auth || auth.apiKeyId !== forgedKeyId) {
							return auth;
						}

						const stored = auth.capabilities as {
							collections?: Record<string, unknown>;
						};

						return {
							...auth,
							capabilities: {
								...stored,
								collections: { ...stored.collections, ...FORGED_COLLECTIONS },
							},
						};
					},
				},
			},
		});

		const { payload } = booted;
		const user = await payload.create({
			collection: "users",
			data: { email: USER_EMAIL, password: "unexposed-secret" },
		});

		plainKey = await createKey(payload, {
			userId: user.id,
			label: KEY_LABEL,
			capabilities: FULL,
		});
		forgedKey = await createKey(payload, {
			userId: user.id,
			label: "forged",
			capabilities: FULL,
		});

		const keys = await payload.find({
			collection: API_KEYS_SLUG as never,
			overrideAccess: true,
		});
		const byLabel = (label: string) =>
			keys.docs.find(
				(doc) => (doc as unknown as { label: string }).label === label,
			)?.id;

		forgedKeyId = byLabel("forged");

		const note = await payload.create({
			collection: "notes",
			data: { title: NOTE_TITLE },
			draft: true,
		});

		targets = {
			notes: note.id,
			users: user.id,
			[API_KEYS_SLUG]: byLabel(KEY_LABEL) as number | string,
		};
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	/** Everything a write could have touched, read past access control. */
	const snapshot = async (): Promise<unknown> => {
		const { payload } = booted;
		const read = (collection: string) =>
			payload.find({
				collection: collection as never,
				draft: true,
				overrideAccess: true,
				showHiddenFields: true,
				pagination: false,
			});

		return {
			notes: (await read("notes")).docs,
			noteVersions: (
				await payload.findVersions({
					collection: "notes",
					overrideAccess: true,
					pagination: false,
				})
			).docs,
			users: (await read("users")).docs,
			keys: (await read(API_KEYS_SLUG)).docs,
		};
	};

	const callsFor = (
		slug: string,
	): { name: string; args: Record<string, unknown> }[] => {
		const id = targets[slug];
		const field =
			slug === "users" ? "/email" : slug === "notes" ? "/title" : "/label";

		return [
			{ name: "describeSchema", args: { collection: slug } },
			{ name: "findDocuments", args: { collection: slug } },
			{ name: "getDocument", args: { collection: slug, id } },
			{ name: "findVersions", args: { collection: slug, id } },
			{
				name: "patchDocument",
				args: {
					collection: slug,
					id,
					locale: "en",
					patches: [{ op: "replace", path: field, value: "overwritten" }],
				},
			},
			{
				name: "createDocument",
				args: {
					collection: slug,
					locale: "en",
					data:
						slug === "users"
							? { email: "minted@example.com", password: "minted-secret" }
							: { title: "minted", label: "minted" },
				},
			},
			{
				name: "validateDocument",
				args: { collection: slug, id, locale: "en" },
			},
			{ name: "publishDocument", args: { collection: slug, id } },
		];
	};

	it("authenticates the forged key and lists only exposed collections", async () => {
		const { isError, data } = await callTool(
			booted.config,
			forgedKey,
			"listCapabilities",
			{},
			CACHE_KEY,
		);
		const slugs = (data["collections"] as { slug: string }[]).map(
			(entry) => entry.slug,
		);

		expect(forgedKeyId).toBeDefined();
		expect(isError).toBe(false);
		expect(slugs.sort()).toEqual(["pages", "posts", "tags"]);
	});

	for (const [variant, keyOf] of [
		["a key with full capabilities", () => plainKey],
		["a key whose stored capabilities name the slug", () => forgedKey],
	] as const) {
		for (const slug of ["users", API_KEYS_SLUG, "notes"]) {
			it(`refuses every builtin tool on ${slug} for ${variant}`, async () => {
				const before = await snapshot();

				for (const call of callsFor(slug)) {
					const result = await callTool(
						booted.config,
						keyOf(),
						call.name,
						call.args,
						CACHE_KEY,
					);
					const text = responseText(result);

					expect(result.status).toBe(200);
					expect(refused(result), `${call.name}: ${text}`).toBe(true);
					expect(text).not.toContain(NOTE_TITLE);
					expect(text).not.toContain(USER_EMAIL);
					expect(text).not.toContain(KEY_LABEL);
				}

				expect(await snapshot()).toEqual(before);
			});
		}
	}
});
