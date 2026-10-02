import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, createKey, seedKeysFor } from "./helpers/payload.js";

import type { CallResult } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-responses";

/**
 * Replaces values that differ between runs. Everything else is compared
 * literally, so a changed message, field name or shape fails the spec.
 */
const normalise = (value: unknown): unknown => {
	if (Array.isArray(value)) {
		return value.map(normalise);
	}

	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => {
				if (key === "id" || key === "versionId") {
					return [key, "<id>"];
				}

				if (key === "createdAt" || key === "updatedAt") {
					return [key, "<timestamp>"];
				}

				return [key, normalise(entry)];
			}),
		);
	}

	return value;
};

const reply = (result: CallResult) => ({
	status: result.status,
	isError: result.isError,
	...(result.rpcError
		? { rpcError: result.rpcError }
		: { payload: normalise(result.data) }),
});

describe("tool responses", () => {
	let booted: Booted;
	let full: string;
	let disabled: string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				collections: {
					pages: { read: true, write: "live" },
					posts: { read: true, write: "draft" },
					tags: { read: true, write: "live" },
					notes: { read: true, write: "live" },
				},
				globals: { "site-settings": { read: true, write: "live" } },
				tools: [],
			},
		});

		const capabilities = {
			collections: {
				pages: { read: true, write: true, publish: true },
				posts: { read: true, write: true },
				tags: { read: true, write: true },
				notes: { read: true, write: true, publish: true },
			},
			globals: { siteSettings: { read: true, write: true, publish: true } },
		};

		const { userId, keys } = await seedKeysFor(booted.payload, {
			full: capabilities,
		});

		full = keys.full;
		disabled = await createKey(booted.payload, {
			userId,
			label: "disabled",
			capabilities,
			enabled: false,
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const call = async (
		name: string,
		args: Record<string, unknown>,
		key = full,
	) => reply(await createMcpClient(booted, key).call(name, args));

	const seedTag = (name: string) =>
		booted.payload.create({ collection: "tags", data: { name } });

	const seedNote = (title: string) =>
		booted.payload.create({
			collection: "notes",
			data: { title },
			draft: true,
		});

	describe("listCapabilities", () => {
		it("describes everything the key may reach", async () => {
			expect(await call("listCapabilities", {})).toEqual({
				status: 200,
				isError: false,
				payload: {
					collections: [
						{
							slug: "pages",
							labels: { singular: "Page", plural: "Pages" },
							description: "Marketing pages rendered on the public site.",
							read: true,
							write: true,
							create: true,
							publish: true,
							drafts: true,
							versions: true,
							draftValidation: false,
							idType: "number",
						},
						{
							slug: "posts",
							labels: { singular: "Post", plural: "Posts" },
							read: true,
							write: true,
							create: true,
							publish: false,
							drafts: true,
							versions: true,
							draftValidation: false,
							idType: "number",
						},
						{
							slug: "tags",
							labels: { singular: "Tag", plural: "Tags" },
							read: true,
							write: true,
							create: true,
							publish: false,
							drafts: false,
							versions: false,
							draftValidation: false,
							idType: "number",
						},
						{
							slug: "notes",
							labels: { singular: "Note", plural: "Notes" },
							read: true,
							write: true,
							create: true,
							publish: true,
							drafts: true,
							versions: true,
							draftValidation: true,
							idType: "number",
						},
					],
					globals: [
						{
							slug: "site-settings",
							label: "Site Settings",
							description: "Settings shared by every page.",
							read: true,
							write: true,
							publish: true,
							drafts: true,
							versions: true,
							draftValidation: false,
						},
					],
					locales: { codes: ["en", "de"], default: "en" },
					limits: { maxLimit: 25, maxDepth: 1 },
					tools: [],
				},
			});
		});

		it("refuses a disabled key", async () => {
			expect(await call("listCapabilities", {}, disabled)).toEqual({
				status: 401,
				isError: false,
				rpcError: {
					code: -32001,
					message: "Unauthorized: a valid API key is required.",
				},
			});
		});
	});

	describe("describeSchema", () => {
		it("describes a collection", async () => {
			expect(await call("describeSchema", { collection: "tags" })).toEqual({
				status: 200,
				isError: false,
				payload: [
					{
						collection: "tags",
						fields: [{ path: "/name", type: "text", required: true }],
						schemaPath: "",
					},
				],
			});
		});

		it("refuses a collection and a global together", async () => {
			expect(
				await call("describeSchema", {
					collection: "pages",
					global: "site-settings",
				}),
			).toEqual({
				status: 200,
				isError: true,
				payload: {
					error: 'Pass either "collection" or "global", not both.',
					status: 400,
				},
			});
		});
	});

	describe("findDocuments", () => {
		it("returns the matching page of documents", async () => {
			await seedTag("find-me");

			expect(
				await call("findDocuments", {
					collection: "tags",
					where: { name: { equals: "find-me" } },
				}),
			).toEqual({
				status: 200,
				isError: false,
				payload: {
					docs: [
						{
							id: "<id>",
							name: "find-me",
							updatedAt: "<timestamp>",
							createdAt: "<timestamp>",
						},
					],
					totalDocs: 1,
					page: 1,
					totalPages: 1,
					limit: 10,
					hasNextPage: false,
				},
			});
		});

		it("refuses a query on a path that does not exist", async () => {
			expect(
				await call("findDocuments", {
					collection: "tags",
					where: { nope: { equals: 1 } },
				}),
			).toEqual({
				status: 200,
				isError: true,
				payload: {
					error: "The following path cannot be queried: nope",
					status: 400,
				},
			});
		});
	});

	describe("getDocument", () => {
		it("returns the document", async () => {
			const tag = await seedTag("get-me");

			expect(
				await call("getDocument", { collection: "tags", id: tag.id }),
			).toEqual({
				status: 200,
				isError: false,
				payload: {
					id: "<id>",
					name: "get-me",
					updatedAt: "<timestamp>",
					createdAt: "<timestamp>",
				},
			});
		});

		it("refuses a document that does not exist", async () => {
			expect(
				await call("getDocument", { collection: "tags", id: 999_999 }),
			).toEqual({
				status: 200,
				isError: true,
				payload: { error: "Not Found", status: 404 },
			});
		});
	});

	describe("findVersions", () => {
		it("lists the version history", async () => {
			const note = await seedNote("history");

			expect(
				await call("findVersions", { collection: "notes", id: note.id }),
			).toEqual({
				status: 200,
				isError: false,
				payload: {
					versions: [
						{
							versionId: "<id>",
							createdAt: "<timestamp>",
							updatedAt: "<timestamp>",
							status: "draft",
							latest: true,
							autosave: false,
						},
					],
					totalDocs: 1,
					page: 1,
					totalPages: 1,
					hasNextPage: false,
				},
			});
		});

		it("refuses a document that does not exist", async () => {
			expect(
				await call("findVersions", { collection: "notes", id: 999_999 }),
			).toEqual({
				status: 200,
				isError: true,
				payload: { error: "Not Found", status: 404 },
			});
		});
	});

	describe("patchDocument", () => {
		it("applies the patches", async () => {
			const tag = await seedTag("patch-me");

			expect(
				await call("patchDocument", {
					collection: "tags",
					id: tag.id,
					locale: "en",
					patches: [{ op: "replace", path: "/name", value: "patched" }],
				}),
			).toEqual({
				status: 200,
				isError: false,
				payload: { id: "<id>", updatedAt: "<timestamp>" },
			});
		});

		it("refuses a patch that addresses no field", async () => {
			const tag = await seedTag("patch-refused");

			expect(
				await call("patchDocument", {
					collection: "tags",
					id: tag.id,
					locale: "en",
					patches: [{ op: "replace", path: "/nothing", value: "x" }],
				}),
			).toEqual({
				status: 200,
				isError: true,
				payload: {
					error: "No operation was applied.",
					problems: [
						'patches[0]: "/nothing" is not a field here. Available: /name',
					],
				},
			});
		});
	});

	describe("createDocument", () => {
		it("creates a document", async () => {
			expect(
				await call("createDocument", {
					collection: "tags",
					locale: "en",
					data: { name: "created" },
				}),
			).toEqual({
				status: 200,
				isError: false,
				payload: { id: "<id>", updatedAt: "<timestamp>" },
			});
		});

		it("refuses a document missing a required field", async () => {
			expect(
				await call("createDocument", {
					collection: "tags",
					locale: "en",
					data: {},
				}),
			).toEqual({
				status: 200,
				isError: true,
				payload: {
					error: "The following field is invalid: Name",
					status: 400,
					validationErrors: [
						{
							label: "Name",
							message: "This field is required.",
							path: "/name",
						},
					],
				},
			});
		});
	});

	describe("validateDocument", () => {
		it("reports the publish blockers of a draft", async () => {
			const page = await booted.payload.create({
				collection: "pages",
				data: { slug: "validate-me" },
				draft: true,
				locale: "en",
			});

			expect(
				await call("validateDocument", {
					collection: "pages",
					id: page.id,
					locale: "en",
				}),
			).toEqual({
				status: 200,
				isError: false,
				payload: {
					id: "<id>",
					status: "draft",
					updatedAt: "<timestamp>",
					publishBlockers: [
						{
							message: "This field is required.",
							path: "/title",
							field: "General > Title",
						},
						{
							message: "This field requires at least 1 Row.",
							path: "/layout/sections",
							field: "Layout > Sections",
						},
					],
				},
			});
		});

		it("refuses a collection call without an id", async () => {
			expect(
				await call("validateDocument", { collection: "tags", locale: "en" }),
			).toEqual({
				status: 200,
				isError: true,
				payload: {
					error: '"id" is required when "collection" is "tags".',
					status: 400,
				},
			});
		});
	});

	describe("publishDocument", () => {
		it("publishes the draft", async () => {
			const note = await seedNote("publish-me");

			expect(
				await call("publishDocument", { collection: "notes", id: note.id }),
			).toEqual({
				status: 200,
				isError: false,
				payload: { id: "<id>", status: "published", updatedAt: "<timestamp>" },
			});
		});

		it("refuses a draft that has publish blockers", async () => {
			const page = await booted.payload.create({
				collection: "pages",
				data: { slug: "publish-refused" },
				draft: true,
				locale: "en",
			});

			expect(
				await call("publishDocument", { collection: "pages", id: page.id }),
			).toEqual({
				status: 200,
				isError: true,
				payload: {
					error:
						"The following fields are invalid: General > Title, Layout > Sections",
					status: 400,
					validationErrors: [
						{
							label: "General > Title",
							message: "This field is required.",
							path: "/title",
						},
						{
							label: "Layout > Sections",
							message: "This field requires at least 1 Row.",
							path: "/layout/sections",
						},
					],
				},
			});
		});
	});
});
