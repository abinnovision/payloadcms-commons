import { describe, expect, it, vi } from "vitest";

import {
	forceDraftWrite,
	installDraftGuards,
	isMcpxRequest,
	refusePublish,
} from "./draft-guard.js";

import type { CollectionConfig, PayloadRequest } from "payload";

const mcpxRequest = {
	context: {
		mcpx: { apiKeyId: "key", capabilities: { collections: {}, tools: {} } },
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
	const hookArgs: unknown = { args, operation, req };

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
