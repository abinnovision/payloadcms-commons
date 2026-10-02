import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient, mcpPost } from "./helpers/mcp.js";
import {
	bootPayload,
	FULL_CAPABILITIES,
	seedKeysFor,
} from "./helpers/payload.js";
import { paragraph } from "../builders/lexical.js";

import type { McpClient } from "./helpers/mcp.js";
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
	let mcp: McpClient;
	let postId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({ key: CACHE_KEY });

		key = (await seedKeysFor(booted.payload, { proto: FULL_CAPABILITIES })).keys
			.proto;
		mcp = createMcpClient(booted, key);

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

		const result = await mcp.call("patchDocument", {
			collection: "posts",
			id: postId,
			locale: "en",
			patches: [{ op, path: pointer, value: { polluted: "yes" } }],
		});

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
		it(`refuses ${op} of a rich text node property named prototype and changes nothing`, async () => {
			const { refused, before, after } = await patchAt(op, NODE_PROTOTYPE);

			expect(refused).toBe(true);
			expect(after).toEqual(before);
			expect(isPolluted()).toBe(false);
		});
	}

	for (const op of ["move", "copy"] as const) {
		it(`refuses ${op} from a prototype segment and changes nothing`, async () => {
			const before = await stored();

			const result = await mcp.call("patchDocument", {
				collection: "posts",
				id: postId,
				locale: "en",
				patches: [{ op, from: NODE_PROTOTYPE, path: "/title" }],
			});

			expect(result.isError).toBe(true);
			expect(result.data["problems"]).toEqual([
				`patches[0]: "${NODE_PROTOTYPE}" contains a segment named __proto__, constructor or prototype, which no field or node property uses.`,
			]);
			expect(await stored()).toEqual(before);
			expect(isPolluted()).toBe(false);
		});
	}

	for (const pointer of [...POINTERS, NODE_PROTOTYPE]) {
		it(`refuses to read ${pointer} and changes nothing`, async () => {
			const before = await stored();

			const result = await mcp.call("getDocument", {
				collection: "posts",
				id: postId,
				locale: "en",
				path: pointer,
			});

			expect(result.isError).toBe(true);
			expect(result.data["error"]).toBe(
				`"${pointer}" contains a segment named __proto__, constructor or prototype, which no field or node property uses.`,
			);
			expect(await stored()).toEqual(before);
			expect(isPolluted()).toBe(false);
		});
	}

	/*
	 * Zod's record parsing skips a `__proto__` key, so it never reaches the
	 * tool and the rest of the seed is created.
	 */
	it("creates a document from data carrying a __proto__ key without that key", async () => {
		// The literal is sent as JSON text so `__proto__` arrives as an own key.
		const response = await mcpPost(booted, {
			key,
			rawBody: `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"createDocument","arguments":{"collection":"posts","locale":"en","data":{"title":"Proto create","__proto__":{"polluted":"yes"}}}}}`,
		});
		const body = (await response.json()) as {
			result?: { isError?: boolean; content?: { text: string }[] };
		};

		expect(body.result?.isError).toBeUndefined();

		const { id } = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as {
			id: number | string;
		};
		const doc = (await booted.payload.findByID({
			collection: "posts",
			id,
			draft: true,
			overrideAccess: true,
		})) as unknown as Record<string, unknown>;

		expect(doc["title"]).toBe("Proto create");
		expect(Object.hasOwn(doc, "__proto__")).toBe(false);
		expect(doc["polluted"]).toBeUndefined();
		expect(isPolluted()).toBe(false);
	});
});
