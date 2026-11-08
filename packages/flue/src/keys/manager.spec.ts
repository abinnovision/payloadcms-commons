import { describe, expect, it } from "vitest";

import { sameCapabilities } from "./manager.js";

const WANTED = {
	collections: {
		pages: { read: true, write: false },
		posts: { read: true, delete: false },
	},
	globals: {},
	tools: { search: true },
};

describe("sameCapabilities", () => {
	it("matches equal shapes", () => {
		expect(sameCapabilities(structuredClone(WANTED), WANTED)).toBe(true);
	});

	it("matches a stored null with a wanted false", () => {
		const stored = {
			collections: {
				pages: { read: true, write: null },
				posts: { read: true, delete: null },
			},
			tools: { search: true },
		};

		expect(sameCapabilities(stored, WANTED)).toBe(true);
	});

	it("differs from an extra stored grant", () => {
		const stored = structuredClone(WANTED);

		stored.collections.posts.delete = true;

		expect(sameCapabilities(stored, WANTED)).toBe(false);
	});

	it("differs from a missing group", () => {
		const { tools: _tools, ...stored } = WANTED;

		expect(sameCapabilities(stored, WANTED)).toBe(false);
		expect(
			sameCapabilities(
				{ ...WANTED, collections: { pages: WANTED.collections.pages } },
				WANTED,
			),
		).toBe(false);
	});
});
