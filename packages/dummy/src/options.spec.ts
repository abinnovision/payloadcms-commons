import { describe, expect, it } from "vitest";

import { normalizeOptions } from "./options.js";
import { buildFixtureConfig } from "../test/fixtures/config.js";

import type { DummyRunOptions } from "./types.js";
import type { Payload, SanitizedConfig } from "payload";

/*
 * Only `config` is read, so a structural stub stands in for the instance. A
 * unit spec never boots Payload.
 */
const stub = (config: SanitizedConfig): Payload =>
	({ config }) as unknown as Payload;

const normalize = async (
	over: Partial<DummyRunOptions> = {},
): Promise<ReturnType<typeof normalizeOptions>> =>
	normalizeOptions({
		payload: stub(await buildFixtureConfig()),
		seeds: [],
		...over,
	});

describe("normalizeOptions", () => {
	it("derives a natural key from the single unique field", async () => {
		const options = await normalize();

		expect(options.keyFor("pages")).toBe("slug");
		expect(options.keyFor("tags")).toBe("name");
		expect(options.keyFor("snippets")).toBe("key");
	});

	it("derives email on an auth collection, which Payload marks unique", async () => {
		expect((await normalize()).keyFor("users")).toBe("email");
	});

	it("answers undefined for a keyless collection when the key is optional", async () => {
		expect((await normalize()).optionalKeyFor("keyless")).toBeUndefined();
	});

	it("still refuses an ambiguous collection when the key is optional", async () => {
		const options = await normalize();

		expect(() => options.optionalKeyFor("ambiguous")).toThrow(
			/more than one unique field/,
		);
	});

	it("prefers an override to the derived key", async () => {
		const options = await normalize({ naturalKeys: { pages: "title" } });

		expect(options.keyFor("pages")).toBe("title");
	});

	it("refuses a collection with two unique fields, naming both", async () => {
		const options = await normalize();

		expect(() => options.keyFor("ambiguous")).toThrow(
			/more than one unique field \(code, label\)/,
		);
	});

	it("refuses a collection with no unique field", async () => {
		const options = await normalize();

		expect(() => options.keyFor("keyless")).toThrow(/has no unique field/);
	});

	it("does not refuse at normalize time, only at first use", async () => {
		await expect(normalize()).resolves.toBeDefined();
	});

	it("names the collections that exist when given one that does not", async () => {
		const options = await normalize();

		expect(() => options.keyFor("nope")).toThrow(
			/no collection "nope".*Collections: users, pages/s,
		);
	});

	it("reads drafts off the config rather than being told", async () => {
		const options = await normalize();

		expect(options.collectionHasDrafts("pages")).toBe(true);
		expect(options.collectionHasDrafts("tags")).toBe(false);
		// Versions without drafts: a write goes live and leaves a version.
		expect(options.collectionHasDrafts("snippets")).toBe(false);
	});

	it("reads a global's drafts off the config too", async () => {
		const options = await normalize();

		expect(options.globalHasDrafts("site-settings")).toBe(true);
		expect(options.globalHasDrafts("banner")).toBe(false);
	});

	it("knows which collections take a file", async () => {
		const options = await normalize();

		expect(options.isUpload("media")).toBe(true);
		expect(options.isUpload("pages")).toBe(false);
	});

	it("defaults fresh, the reset list and the reporter", async () => {
		const options = await normalize();

		expect(options.fresh).toBe(false);
		expect(options.resetCollections).toEqual([]);
		expect(options.reporter).toEqual({});
	});
});
