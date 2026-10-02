import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool, mcpPost } from "./helpers/mcp.js";
import {
	bootPayload,
	createKey,
	FULL_CAPABILITIES,
	paragraph,
} from "./helpers/payload.js";

import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-prototype-segments";

const POINTERS = [
	"/__proto__",
	"/__proto__/polluted",
	"/constructor/prototype/polluted",
	"/prototype",
	"/content/root/__proto__",
	"/content/root/__proto__/polluted",
	"/content/root/constructor",
	"/content/root/prototype",
	"/content/root/children/0/__proto__",
	"/content/root/children/0/constructor",
	"/content/root/children/0/children/0/__proto__",
];

/*
 * A node may carry any property a feature puts on it, so this one is checked
 * apart from the others.
 */
const NODE_PROTOTYPE = "/content/root/children/0/prototype";

const isPolluted = (): boolean =>
	(Object.prototype as Record<string, unknown>)["polluted"] !== undefined;

describe("prototype segments in writes", () => {
	let booted: Booted;
	let key: string;
	let postId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({ key: CACHE_KEY });

		const user = await booted.payload.create({
			collection: "users",
			data: { email: "proto@example.com", password: "proto-secret" },
		});

		key = await createKey(booted.payload, {
			userId: user.id,
			label: "proto",
			capabilities: FULL_CAPABILITIES,
		});

		const post = await booted.payload.create({
			collection: "posts",
			locale: "en",
			draft: true,
			data: {
				title: "Proto",
				content: paragraph("Hello"),
				items: [
					{ heading: "Row", actions: [{ blockType: "cta", label: "Go" }] },
				],
			},
		});

		postId = post.id;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const stored = async (): Promise<unknown> => ({
		doc: await booted.payload.findByID({
			collection: "posts",
			id: postId,
			draft: true,
			locale: "all",
			overrideAccess: true,
		}),
		versions: (
			await booted.payload.findVersions({
				collection: "posts",
				where: { parent: { equals: postId } },
				overrideAccess: true,
			})
		).totalDocs,
	});

	const patchAt = async (op: "add" | "replace", pointer: string) => {
		const before = await stored();

		const result = await callTool(
			booted.config,
			key,
			"patchDocument",
			{
				collection: "posts",
				id: postId,
				locale: "en",
				patches: [{ op, path: pointer, value: { polluted: "yes" } }],
			},
			CACHE_KEY,
		);

		return {
			refused: result.isError || result.rpcError !== undefined,
			before,
			after: await stored(),
		};
	};

	for (const pointer of POINTERS) {
		for (const op of ["add", "replace"] as const) {
			it(`refuses ${op} at ${pointer} and changes nothing`, async () => {
				const { refused, before, after } = await patchAt(op, pointer);

				expect(refused).toBe(true);
				expect(after).toEqual(before);
				expect(isPolluted()).toBe(false);
			});
		}
	}

	for (const op of ["add", "replace"] as const) {
		it.fails(
			`writes a rich text node property named prototype through ${op}`,
			async () => {
				const { refused, before, after } = await patchAt(op, NODE_PROTOTYPE);

				expect(refused).toBe(true);
				expect(after).toEqual(before);
				expect(isPolluted()).toBe(false);
			},
		);
	}

	it.fails(
		"creates a document from data carrying a __proto__ key",
		async () => {
			const before = await booted.payload.count({ collection: "posts" });

			// The literal is sent as JSON text so `__proto__` arrives as an own key.
			const response = await mcpPost(booted.config, {
				cacheKey: CACHE_KEY,
				key,
				rawBody: `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"createDocument","arguments":{"collection":"posts","locale":"en","data":{"title":"Proto create","__proto__":{"polluted":"yes"}}}}}`,
			});
			const body = (await response.json()) as {
				result?: { isError?: boolean };
				error?: unknown;
			};

			expect(body.result?.isError === true || body.error !== undefined).toBe(
				true,
			);
			expect(await booted.payload.count({ collection: "posts" })).toEqual(
				before,
			);
			expect(isPolluted()).toBe(false);
		},
	);
});
