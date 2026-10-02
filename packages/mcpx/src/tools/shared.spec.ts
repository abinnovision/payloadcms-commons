import { describe, expect, it } from "vitest";

import { liveWriteSentence, patchOnlySlugs, slugsFor } from "./shared.js";
import { entity, scopeFor } from "../../test/builders/scope.js";

/** Writes without drafts, so nothing is left to publish. */
const LIVE_ONLY = { write: "live", hasDrafts: false } as const;

describe("liveWriteSentence", () => {
	it("promises drafts when no write of the key goes live", () => {
		const sentence = liveWriteSentence(
			scopeFor(
				{ collections: [entity("pages", { write: "live" })] },
				{ collections: { pages: { write: true, publish: true } } },
			),
			"write",
		);

		expect(sentence).toBe("Every write is saved as a draft.");
	});

	it("names the slugs whose writes go live because they have no drafts", () => {
		const scope = scopeFor(
			{
				collections: [entity("pages"), entity("tags", LIVE_ONLY)],
				globals: [entity("banner", LIVE_ONLY)],
			},
			{
				collections: { pages: { write: true }, tags: { write: true } },
				globals: { banner: { write: true } },
			},
		);

		expect(liveWriteSentence(scope, "write")).toContain(
			"Writes to tags, banner go live immediately.",
		);
		expect(liveWriteSentence(scope, "write")).not.toContain("pages");
		expect(liveWriteSentence(scope, "create")).toContain(
			"Writes to tags go live immediately.",
		);
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
