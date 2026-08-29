import { describe, expect, it, vi } from "vitest";

import {
	forceDraftWrite,
	forceDraftWriteGlobal,
	installDraftGuards,
	installGlobalDraftGuards,
	refusePublish,
	refusePublishGlobal,
} from "./draft-guard.js";
import { withPublishIntent } from "./publish-intent.js";
import { isMcpxRequest } from "../request.js";

import type { CollectionConfig, GlobalConfig, PayloadRequest } from "payload";

const mcpxRequest = {
	context: {
		mcpx: {
			apiKeyId: "key",
			capabilities: { collections: {}, globals: {}, tools: {} },
		},
	},
};
const restRequest = { context: {} };

/**
 * Runs the `beforeOperation` hook and returns the arguments the operation
 * would actually receive.
 */
const operationArgumentsFor = (
	args: Record<string, unknown>,
	operation = "update",
	req: Record<string, unknown> = mcpxRequest,
): Record<string, unknown> => {
	const hookArgs: unknown = {
		args,
		collection: { slug: "pages" },
		operation,
		req,
	};

	return forceDraftWrite(hookArgs as never) as Record<string, unknown>;
};

const runRefusal = (
	status: unknown,
	req: Record<string, unknown> = mcpxRequest,
) => {
	const warn = vi.fn();
	const hookArgs: unknown = {
		collection: { slug: "pages" },
		data: status === undefined ? {} : { _status: status },
		req: { ...req, payload: { logger: { warn } } },
	};

	return { call: () => refusePublish(hookArgs as never), warn };
};

describe("isMcpxRequest", () => {
	it("recognises the marker the endpoint stamps", () => {
		expect(isMcpxRequest(mcpxRequest as unknown as PayloadRequest)).toBe(true);
	});

	it("ignores every other request", () => {
		expect(isMcpxRequest(restRequest as unknown as PayloadRequest)).toBe(false);
	});
});

describe("forceDraftWrite", () => {
	it("leaves a non-mcpx operation untouched", () => {
		const args = { data: { _status: "published" }, draft: false };

		expect(operationArgumentsFor(args, "update", restRequest)).toEqual(args);
	});

	it("leaves operations other than create and update untouched", () => {
		const args = { where: { id: { equals: 1 } } };

		expect(operationArgumentsFor(args, "delete")).toEqual(args);
	});

	it("forces a draft save", () => {
		expect(operationArgumentsFor({ data: {}, draft: false })).toMatchObject({
			autosave: false,
			draft: true,
			overrideLock: false,
			trash: false,
		});
	});

	it("drops a published status smuggled in alongside draft", () => {
		const args = operationArgumentsFor({
			data: { _status: "published", title: "Probe" },
			draft: true,
		});

		expect(args["data"]).toEqual({ title: "Probe" });
	});

	it("drops a draft status too, leaving payload to set it", () => {
		expect(
			operationArgumentsFor({ data: { _status: "draft", title: "Probe" } })[
				"data"
			],
		).toEqual({ title: "Probe" });
	});

	it("drops a soft delete marker", () => {
		expect(
			operationArgumentsFor({
				data: { deletedAt: "2026-01-01", title: "Probe" },
			})["data"],
		).toEqual({ title: "Probe" });
	});

	it("removes the bulk where clause", () => {
		expect(
			operationArgumentsFor({ data: {}, where: { slug: { exists: true } } }),
		).not.toHaveProperty("where");
	});

	it("removes the publish, locale and duplication arguments", () => {
		const args = operationArgumentsFor({
			data: {},
			duplicateFromID: "1",
			overwriteExistingFiles: true,
			publishAllLocales: true,
			publishSpecificLocale: "de",
			selectedLocales: ["de"],
			unpublishAllLocales: true,
		});

		for (const key of [
			"duplicateFromID",
			"overwriteExistingFiles",
			"publishAllLocales",
			"publishSpecificLocale",
			"selectedLocales",
			"unpublishAllLocales",
		]) {
			expect(args).not.toHaveProperty(key);
		}
	});

	it("preserves the arguments it does not police", () => {
		expect(
			operationArgumentsFor({ data: { title: "Probe" }, depth: 0, id: "1" }),
		).toMatchObject({ depth: 0, id: "1" });
	});

	it("tolerates an operation with no data", () => {
		expect(operationArgumentsFor({ id: "1" })).toMatchObject({ draft: true });
	});
});

describe("forceDraftWrite on a claimed publish", () => {
	const publishIntent = { kind: "collection", slug: "pages", id: "1" } as const;

	it("turns the operation into a publish, and nothing else", async () => {
		const args = await withPublishIntent(publishIntent, () =>
			Promise.resolve(
				operationArgumentsFor({
					data: { title: "Probe", _status: "draft", deletedAt: "now" },
					id: "1",
					where: { id: { equals: "2" } },
					publishSpecificLocale: "de",
					overrideLock: true,
					trash: true,
				}),
			),
		);

		expect(args).toMatchObject({
			draft: false,
			data: { title: "Probe", _status: "published" },
			autosave: false,
			overrideLock: false,
			trash: false,
		});
		expect(args["data"]).not.toHaveProperty("deletedAt");

		for (const key of ["where", "publishSpecificLocale"]) {
			expect(args).not.toHaveProperty(key);
		}
	});

	it("ignores an intent for another document", async () => {
		const args = await withPublishIntent({ ...publishIntent, id: "2" }, () =>
			Promise.resolve(operationArgumentsFor({ data: {}, id: "1" })),
		);

		expect(args).toMatchObject({ draft: true });
		expect(args["data"]).not.toHaveProperty("_status");
	});

	it("does not publish a create", async () => {
		const args = await withPublishIntent(publishIntent, () =>
			Promise.resolve(operationArgumentsFor({ data: {}, id: "1" }, "create")),
		);

		expect(args).toMatchObject({ draft: true });
	});
});

describe("refusePublish", () => {
	it("leaves a non-mcpx publish alone", () => {
		const { call } = runRefusal("published", restRequest);

		expect(call()).toEqual({ _status: "published" });
	});

	it("allows an mcpx draft", () => {
		expect(runRefusal("draft").call()).toEqual({ _status: "draft" });
	});

	it("refuses an mcpx publish and reports it", () => {
		const { call, warn } = runRefusal("published");

		expect(call).toThrow(/only write drafts/);
		expect(warn).toHaveBeenCalledOnce();
	});

	it("refuses an mcpx write with no status", () => {
		expect(runRefusal(undefined).call).toThrow();
	});

	it("allows the publish the operation claimed, and only that", async () => {
		const intent = { kind: "collection", slug: "pages", id: "1" } as const;

		await withPublishIntent(intent, () => {
			// Nothing has claimed it yet, so the alarm still expects a draft.
			expect(runRefusal("published").call).toThrow(/only write drafts/);

			// Claims the intent, exactly as the real operation does.
			operationArgumentsFor({ data: {}, id: "1" });

			expect(runRefusal("published").call()).toEqual({
				_status: "published",
			});
			expect(runRefusal("draft").call).toThrow(/would not have saved/);

			return Promise.resolve();
		});
	});
});

describe("installDraftGuards", () => {
	const live: CollectionConfig = { slug: "tags", fields: [] };
	const drafts: CollectionConfig = {
		slug: "pages",
		versions: { drafts: true },
		fields: [],
		hooks: { beforeOperation: [() => undefined] },
	};

	it("adds the operation guard to every collection", () => {
		const [tags, pages] = installDraftGuards([live, drafts]);

		expect(tags?.hooks?.beforeOperation).toEqual([forceDraftWrite]);
		expect(pages?.hooks?.beforeOperation).toHaveLength(2);
		expect(pages?.hooks?.beforeOperation?.at(-1)).toBe(forceDraftWrite);
	});

	it("adds the publish alarm only where drafts exist", () => {
		const [tags, pages] = installDraftGuards([live, drafts]);

		expect(tags?.hooks?.beforeChange).toBeUndefined();
		expect(pages?.hooks?.beforeChange).toEqual([refusePublish]);
	});
});

/**
 * Runs the global `beforeOperation` hook and returns the arguments the
 * operation would actually receive.
 */
const globalOperationArgumentsFor = (
	args: Record<string, unknown>,
	operation = "update",
	req: Record<string, unknown> = mcpxRequest,
): Record<string, unknown> => {
	const hookArgs: unknown = {
		args,
		global: { slug: "site-settings" },
		operation,
		req,
	};

	return forceDraftWriteGlobal(hookArgs as never) as Record<string, unknown>;
};

describe("forceDraftWriteGlobal", () => {
	it("leaves a non-MCP request untouched", () => {
		const args = { data: { _status: "published" }, slug: "site-settings" };

		expect(globalOperationArgumentsFor(args, "update", restRequest)).toBe(args);
	});

	it("leaves a read untouched", () => {
		const args = { slug: "site-settings" };

		expect(globalOperationArgumentsFor(args, "read")).toBe(args);
	});

	it("forces the write into a draft save", () => {
		const next = globalOperationArgumentsFor({
			data: { _status: "published", title: "Home" },
			slug: "site-settings",
		});

		expect(next["draft"]).toBe(true);
		expect(next["data"]).toEqual({ title: "Home" });
	});

	it("strips every publish vector updateGlobal accepts", () => {
		const next = globalOperationArgumentsFor({
			data: { title: "Home" },
			publishAllLocales: true,
			publishSpecificLocale: "de",
			slug: "site-settings",
			unpublishAllLocales: true,
		});

		expect(next).not.toHaveProperty("publishAllLocales");
		expect(next).not.toHaveProperty("publishSpecificLocale");
		expect(next).not.toHaveProperty("unpublishAllLocales");
	});

	it("keeps the slug, so the operation still knows what it updates", () => {
		const next = globalOperationArgumentsFor({
			data: { title: "Home" },
			slug: "site-settings",
		});

		expect(next["slug"]).toBe("site-settings");
	});
});

describe("refusePublishGlobal", () => {
	const run = (status: unknown, req: Record<string, unknown> = mcpxRequest) => {
		const warn = vi.fn();
		const hookArgs: unknown = {
			data: status === undefined ? {} : { _status: status },
			global: { slug: "site-settings" },
			req: { ...req, payload: { logger: { warn } } },
		};

		return { call: () => refusePublishGlobal(hookArgs as never), warn };
	};

	it("passes a draft through", () => {
		expect(() => run("draft").call()).not.toThrow();
	});

	it("refuses anything that would not land as a draft", () => {
		const { call, warn } = run("published");

		expect(call).toThrow(/may only write drafts/);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("site-settings"));
	});

	it("ignores writes that did not come from MCP", () => {
		expect(() => run("published", restRequest).call()).not.toThrow();
	});
});

describe("installGlobalDraftGuards", () => {
	const drafts: GlobalConfig = {
		slug: "site-settings",
		versions: { drafts: true },
		fields: [],
	};
	const live: GlobalConfig = { slug: "banner", fields: [] };

	it("guards every global and refuses publishing only where drafts exist", () => {
		const [guardedDrafts, guardedLive] = installGlobalDraftGuards([
			drafts,
			live,
		]);

		expect(guardedDrafts?.hooks?.beforeOperation).toHaveLength(1);
		expect(guardedDrafts?.hooks?.beforeChange).toEqual([refusePublishGlobal]);
		expect(guardedLive?.hooks?.beforeOperation).toHaveLength(1);
		expect(guardedLive?.hooks?.beforeChange).toBeUndefined();
	});

	it("keeps hooks the global already declared", () => {
		const existing = vi.fn();
		const [guarded] = installGlobalDraftGuards([
			{ ...drafts, hooks: { beforeOperation: [existing] } },
		]);

		expect(guarded?.hooks?.beforeOperation).toEqual([
			existing,
			forceDraftWriteGlobal,
		]);
	});
});
