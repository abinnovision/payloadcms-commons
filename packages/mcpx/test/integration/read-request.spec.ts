import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";
import {
	defineMcpxTool,
	jsonResult,
	mcpxReadRequest,
} from "../../src/index.js";
import { casefiles, dossiers } from "../fixtures/security.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-read-request";

/**
 * Reads a casefile at depth 1 through the bounded request.
 */
const readCasefile = defineMcpxTool({
	name: "readCasefile",
	description: "Reads a casefile with its dossier populated.",
	inputSchema: { id: z.union([z.string(), z.number()]) },
	handler: async ({ args, scope }) =>
		jsonResult(
			await scope.req.payload.findByID({
				collection: "casefiles" as never,
				id: args.id,
				depth: 1,
				overrideAccess: false,
				req: mcpxReadRequest(scope),
			}),
		),
});

describe("mcpxReadRequest in a custom tool", () => {
	let booted: Booted;
	let withDossiers: McpClient;
	let withoutDossiers: McpClient;
	let casefileId: number | string;
	let dossierId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [casefiles, dossiers],
			plugin: {
				collections: {
					casefiles: { write: false },
					dossiers: { write: false },
				},
				tools: [readCasefile],
			},
		});

		const { payload } = booted;
		const dossier = await payload.create({
			collection: "dossiers" as never,
			data: { title: "Linked dossier" },
		});
		const casefile = await payload.create({
			collection: "casefiles" as never,
			data: { _status: "published", title: "Casefile", dossier: dossier.id },
		});

		dossierId = dossier.id;
		casefileId = casefile.id;

		const { keys } = await seedKeysFor(payload, {
			withDossiers: {
				collections: {
					casefiles: { read: true },
					dossiers: { read: true },
				},
				tools: { readCasefile: true },
			},
			withoutDossiers: {
				collections: { casefiles: { read: true } },
				tools: { readCasefile: true },
			},
		});

		withDossiers = createMcpClient(booted, keys.withDossiers);
		withoutDossiers = createMcpClient(booted, keys.withoutDossiers);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("populates a relation into a collection the key can read", async () => {
		const result = await withDossiers.call("readCasefile", { id: casefileId });

		expect(result.isError).toBe(false);
		expect(result.data["dossier"]).toMatchObject({
			id: dossierId,
			title: "Linked dossier",
		});
	});

	it("leaves a relation into a collection the key cannot read as its id", async () => {
		const result = await withoutDossiers.call("readCasefile", {
			id: casefileId,
		});

		expect(result.isError).toBe(false);
		expect(result.data["dossier"]).toBe(dossierId);
	});
});
