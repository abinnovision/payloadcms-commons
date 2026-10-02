import { createLocalReq } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import {
	bootPayload,
	createDraft,
	readDraft,
	seedKeys,
} from "./helpers/payload.js";
import { hero, section } from "../builders/blocks.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted, Seeded } from "./helpers/payload.js";
import type { TypedUser } from "payload";

interface PageDoc {
	id: number | string;
	title?: string | null;
	_status?: string;
	updatedAt: string;
}

describe("patchDocument against concurrent and out-of-band writes", () => {
	let booted: Booted;
	let seeded: Seeded;
	let mcp: McpClient;

	beforeAll(async () => {
		booted = await bootPayload();
		seeded = await seedKeys(booted.payload);
		mcp = createMcpClient(booted, seeded.keys.full);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const createPage = (data: Record<string, unknown>) =>
		createDraft<PageDoc>(booted.payload, "pages", data);

	const readPage = (id: number | string) =>
		readDraft<PageDoc>(booted.payload, "pages", id);

	const readLive = (id: number | string) =>
		booted.payload.findByID({
			collection: "pages",
			id,
			depth: 0,
			draft: false,
		}) as Promise<PageDoc>;

	it("refuses a pointer to a field Payload maintains", async () => {
		const page = await createPage({ title: "Status", slug: "status" });
		const result = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [{ op: "replace", path: "/_status", value: "published" }],
		});

		expect(result.isError).toBe(true);
		expect((await readPage(page.id))._status).toBe("draft");
	});

	it("forces every MCP write into a draft at the operation level", async () => {
		const page = await createPage({
			title: "Guarded",
			slug: "guarded",
			layout: { sections: [section("intro", [hero("Hello")])] },
		});
		const { payload } = booted;
		const user = (await payload.findByID({
			collection: "users",
			id: seeded.userId,
		})) as TypedUser;
		const req = await createLocalReq(
			{
				user: { ...user, collection: "users" },
				context: {
					mcpx: {
						apiKeyId: "test",
						capabilities: { collections: {}, globals: {}, tools: {} },
					},
				},
			},
			payload,
		);

		await payload.update({
			collection: "pages",
			id: page.id,
			data: { title: "Published by tool", _status: "published" },
			draft: false,
			overrideAccess: false,
			req,
		});

		const draft = await readPage(page.id);

		expect(draft.title).toBe("Published by tool");
		expect(draft._status).toBe("draft");
		expect((await readLive(page.id))._status).toBe("draft");
	});

	it("refuses a stale expectedUpdatedAt", async () => {
		const page = await createPage({ title: "Stale", slug: "stale" });
		const first = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "en",
			expectedUpdatedAt: page.updatedAt,
			patches: [{ op: "replace", path: "/title", value: "Second" }],
		});
		const second = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "en",
			expectedUpdatedAt: page.updatedAt,
			patches: [{ op: "replace", path: "/title", value: "Third" }],
		});

		expect(first.isError).toBe(false);
		expect(second.isError).toBe(true);
		expect(second.data["updatedAt"]).toBe(first.data["updatedAt"]);
		expect((await readPage(page.id)).title).toBe("Second");
	});

	it("leaves the published version untouched", async () => {
		const page = (await booted.payload.create({
			collection: "pages",
			locale: "en",
			data: {
				title: "Live",
				slug: "live",
				layout: { sections: [section("intro", [hero("Hello")])] },
				_status: "published",
			},
		})) as PageDoc;

		const result = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [{ op: "replace", path: "/title", value: "Live, edited" }],
		});
		const live = await readLive(page.id);

		expect(result.data["status"]).toBe("draft");
		expect(live.title).toBe("Live");
		expect(live._status).toBe("published");
		expect((await readPage(page.id)).title).toBe("Live, edited");
	});
});
