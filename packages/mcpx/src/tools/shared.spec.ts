import { describe, expect, it } from "vitest";

import { draftSentence, patchOnlySlugs, slugsFor } from "./shared.js";
import { entity, scopeFor } from "../../test/builders/scope.js";

/** Writes without drafts, so nothing is left to publish. */
const LIVE_ONLY = { write: "live", hasDrafts: false } as const;

describe("draftSentence", () => {
	it("promises drafts and no publishing when that is all the key can do", () => {
		const sentence = draftSentence(
			scopeFor(
				{ collections: [entity("pages")] },
				{ collections: { pages: { write: true } } },
			),
		);

		expect(sentence).toContain("Every write lands as a draft.");
		expect(sentence).toContain("Nothing this key writes is ever published");
		expect(sentence).not.toContain("publishDocument");
	});

	it("names the slugs whose writes are live because they have no drafts", () => {
		const sentence = draftSentence(
			scopeFor(
				{
					collections: [entity("pages"), entity("tags", LIVE_ONLY)],
					globals: [entity("banner", LIVE_ONLY)],
				},
				{
					collections: { pages: { write: true }, tags: { write: true } },
					globals: { banner: { write: true } },
				},
			),
		);

		expect(sentence).toContain("except for tags, banner");
		expect(sentence).not.toContain("pages");
	});

	it("names the slugs the key may publish, separately from the live ones", () => {
		const sentence = draftSentence(
			scopeFor(
				{
					collections: [
						entity("pages", { write: "live" }),
						entity("tags", LIVE_ONLY),
					],
				},
				{
					collections: {
						pages: { write: true, publish: true },
						tags: { write: true },
					},
				},
			),
		);

		expect(sentence).toContain("except for tags");
		expect(sentence).toContain(
			"publishDocument, which this key may do for pages",
		);
	});

	it("leaves publishing out for a key that may write but not publish", () => {
		const sentence = draftSentence(
			scopeFor(
				{ collections: [entity("pages", { write: "live" })] },
				{ collections: { pages: { write: true } } },
			),
		);

		expect(sentence).toContain("Every write lands as a draft.");
		expect(sentence).toContain("Nothing this key writes is ever published");
	});
});

describe("slugsFor and patchOnlySlugs", () => {
	const scope = scopeFor(
		{
			collections: [
				entity("pages"),
				entity("media", { isUpload: true }),
				entity("tags", { write: false, hasDrafts: false }),
			],
			globals: [entity("banner")],
		},
		{
			collections: { pages: { write: true }, media: { write: true } },
			globals: { banner: { write: true } },
		},
	);

	it("leaves upload collections and every global out of create", () => {
		expect(slugsFor(scope, "create")).toEqual({
			collections: ["pages"],
			globals: [],
		});
	});

	it("names the writable slugs that cannot be created in", () => {
		expect(patchOnlySlugs(scope)).toEqual(["media"]);
	});
});
