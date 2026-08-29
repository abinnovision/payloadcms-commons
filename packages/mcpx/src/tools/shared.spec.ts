import { describe, expect, it } from "vitest";

import { draftSentence } from "./shared.js";

import type { McpxExposedEntity, McpxToolScope } from "../types.js";

const entity = (
	slug: string,
	write: McpxExposedEntity["write"],
	hasDrafts: boolean,
): McpxExposedEntity => ({
	slug,
	read: true,
	write,
	hasDrafts,
	fieldName: slug,
});

const scopeFor = (args: {
	collections?: McpxExposedEntity[];
	globals?: McpxExposedEntity[];
	writable?: string[];
	writableGlobals?: string[];
	publishable?: string[];
	publishableGlobals?: string[];
}): McpxToolScope =>
	({
		writable: args.writable ?? [],
		writableGlobals: args.writableGlobals ?? [],
		publishable: args.publishable ?? [],
		publishableGlobals: args.publishableGlobals ?? [],
		exposure: {
			collections: args.collections ?? [],
			globals: args.globals ?? [],
		},
	}) as unknown as McpxToolScope;

describe("draftSentence", () => {
	it("promises drafts and no publishing when that is all the key can do", () => {
		const sentence = draftSentence(
			scopeFor({
				collections: [entity("pages", "draft", true)],
				writable: ["pages"],
			}),
		);

		expect(sentence).toContain("Every write lands as a draft.");
		expect(sentence).toContain("Nothing this key writes is ever published");
		expect(sentence).not.toContain("publishDocument");
	});

	it("names the slugs whose writes are live because they have no drafts", () => {
		const sentence = draftSentence(
			scopeFor({
				collections: [
					entity("pages", "draft", true),
					entity("tags", "live", false),
				],
				globals: [entity("banner", "live", false)],
				writable: ["pages", "tags"],
				writableGlobals: ["banner"],
			}),
		);

		expect(sentence).toContain("except for tags, banner");
		expect(sentence).not.toContain("pages");
	});

	it("names the slugs the key may publish, separately from the live ones", () => {
		const sentence = draftSentence(
			scopeFor({
				collections: [
					entity("pages", "live", true),
					entity("tags", "live", false),
				],
				writable: ["pages", "tags"],
				publishable: ["pages"],
			}),
		);

		expect(sentence).toContain("except for tags");
		expect(sentence).toContain(
			"publishDocument, which this key may do for pages",
		);
	});

	it("leaves publishing out for a key that may write but not publish", () => {
		const sentence = draftSentence(
			scopeFor({
				collections: [entity("pages", "live", true)],
				writable: ["pages"],
			}),
		);

		expect(sentence).toContain("Every write lands as a draft.");
		expect(sentence).toContain("Nothing this key writes is ever published");
	});
});
