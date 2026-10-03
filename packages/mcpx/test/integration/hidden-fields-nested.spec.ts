import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, createMedia, seedKeysFor } from "./helpers/payload.js";
import { MEDIA_DIR } from "../fixtures/collections.js";
import { casefiles, dossiers } from "../fixtures/security.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-hidden-fields-nested";

const HIDDEN = {
	note: "hidden note",
	group: "hidden group value",
	row: "hidden row value",
	dossier: "hidden value of the related dossier",
	next: "hidden note of the draft",
};

describe("admin.hidden fields below the top level", () => {
	let booted: Booted;
	let mcp: McpClient;
	let casefileId: number | string;
	let mediaId: number | string;
	let firstVersionId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [casefiles, dossiers],
			plugin: {
				collections: {
					casefiles: { write: false, versions: true },
					dossiers: { write: false },
					media: { write: false },
				},
			},
		});

		const { payload } = booted;
		const dossier = await payload.create({
			collection: "dossiers" as never,
			data: { title: "Linked dossier", adminHidden: HIDDEN.dossier },
		});

		mediaId = (await createMedia(payload, "Cover")).id;

		const casefile = await payload.create({
			collection: "casefiles" as never,
			data: {
				_status: "published",
				title: "First title",
				note: HIDDEN.note,
				details: { label: "Detail label", internal: HIDDEN.group },
				entries: [{ label: "Row label", internal: HIDDEN.row }],
				dossier: dossier.id,
				cover: mediaId,
			},
		});

		casefileId = casefile.id;

		await payload.update({
			collection: "casefiles" as never,
			id: casefileId,
			data: { _status: "published", title: "Second title" },
		});
		await payload.update({
			collection: "casefiles" as never,
			id: casefileId,
			draft: true,
			data: { title: "Draft title", note: HIDDEN.next },
		});

		const versions = await payload.findVersions({
			collection: "casefiles" as never,
			where: { parent: { equals: casefileId } },
			sort: "createdAt",
		});

		firstVersionId = versions.docs[0]?.id as number | string;

		const { keys } = await seedKeysFor(payload, {
			reader: {
				collections: {
					casefiles: { read: true },
					dossiers: { read: true },
					media: { read: true },
				},
			},
		});

		mcp = createMcpClient(booted, keys.reader);
	});

	afterAll(async () => {
		await booted.payload.destroy();
		await rm(MEDIA_DIR, { recursive: true, force: true });
	});

	const expectNoHidden = (text: string | undefined): void => {
		for (const value of Object.values(HIDDEN)) {
			expect(text).not.toContain(value);
		}
	};

	it("leaves out a field inside a group and an array row", async () => {
		const result = await mcp.call("getDocument", {
			collection: "casefiles",
			id: casefileId,
		});

		expect(result.isError).toBe(false);
		expect(result.data).toMatchObject({
			title: "Draft title",
			details: { label: "Detail label" },
			entries: [{ id: expect.any(String), label: "Row label" }],
		});
		expectNoHidden(result.text);
	});

	it("leaves out a field of a populated relation at depth 1", async () => {
		const result = await mcp.call("getDocument", {
			collection: "casefiles",
			id: casefileId,
			depth: 1,
		});

		expect(result.data["dossier"]).toMatchObject({ title: "Linked dossier" });
		expectNoHidden(result.text);
	});

	it("leaves out the same fields in findDocuments results", async () => {
		const result = await mcp.call("findDocuments", {
			collection: "casefiles",
			depth: 1,
		});

		expect(result.text).toContain("Detail label");
		expect(result.text).toContain("Linked dossier");
		expectNoHidden(result.text);
	});

	it("leaves out hidden fields of a version read by versionId", async () => {
		const result = await mcp.call("getDocument", {
			collection: "casefiles",
			id: casefileId,
			versionId: firstVersionId,
			depth: 1,
		});

		expect(result.data["title"]).toBe("First title");
		expect(result.text).toContain("Row label");
		expectNoHidden(result.text);
	});

	it("leaves out hidden fields on both sides of diffFrom", async () => {
		const fromVersion = await mcp.call("getDocument", {
			collection: "casefiles",
			id: casefileId,
			diffFrom: firstVersionId,
		});
		const fromPublished = await mcp.call("getDocument", {
			collection: "casefiles",
			id: casefileId,
			diffFrom: "published",
		});

		expect(fromVersion.data["patch"]).toEqual([
			{ op: "replace", path: "/title", value: "Draft title" },
		]);
		expect(fromPublished.data["patch"]).toEqual([
			{ op: "replace", path: "/title", value: "Draft title" },
		]);
		expectNoHidden(fromVersion.text);
		expectNoHidden(fromPublished.text);
	});

	it("still returns the fields Payload adds to an upload collection", async () => {
		const read = await mcp.call("getDocument", {
			collection: "media",
			id: mediaId,
		});
		const populated = await mcp.call("getDocument", {
			collection: "casefiles",
			id: casefileId,
			depth: 1,
		});

		expect(read.data).toMatchObject({
			filename: "pixel.png",
			mimeType: "image/png",
		});
		expect(typeof read.data["url"]).toBe("string");
		expect(populated.data["cover"]).toMatchObject({ filename: "pixel.png" });
		expect(populated.data["cover"]).toHaveProperty("url");
	});

	const refusal = (path: string) => ({
		error: `This key cannot query through "${path}".`,
		status: 400,
	});

	const refused: [string, Record<string, unknown>, string][] = [
		["a where on a hidden field", { where: { note: { equals: "x" } } }, "note"],
		[
			"a where on a hidden field in a group",
			{ where: { "details.internal": { equals: "x" } } },
			"details.internal",
		],
		[
			"a where on a hidden field in an array",
			{ where: { and: [{ entries__internal: { equals: "x" } }] } },
			"entries__internal",
		],
		[
			"a where on a hidden field of a related document",
			{ where: { "dossier.adminHidden": { equals: "x" } } },
			"dossier.adminHidden",
		],
		["a sort on a hidden field", { sort: "-note" }, "note"],
	];

	for (const [name, query, path] of refused) {
		it(`refuses ${name}`, async () => {
			const result = await mcp.call("findDocuments", {
				collection: "casefiles",
				...query,
			});

			expect(result.data).toEqual(refusal(path));
		});
	}

	it("allows a where on a visible field and on an upload's own fields", async () => {
		const visible = await mcp.call("findDocuments", {
			collection: "casefiles",
			where: { "details.label": { equals: "Detail label" } },
		});
		const file = await mcp.call("findDocuments", {
			collection: "media",
			where: { filename: { equals: "pixel.png" } },
			sort: "filename",
		});

		expect(visible.data["totalDocs"]).toBe(1);
		expect(file.data["totalDocs"]).toBe(1);
	});
});
