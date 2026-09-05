import { beforeAll, describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";
import { loadMappings } from "../../src/config/index.js";

import type { Payload } from "payload";

/**
 * The fallback is needed on both sides: the mapping global validates a pattern
 * against it at save time, and the compiled mappings carry it at run time.
 * Stating it twice is what let the two disagree — a project keyed by `handle`
 * that told only the read side found the admin panel refusing to save the very
 * pattern it had configured for.
 *
 * The plugin is the only place it is set here. Everything below reads it back
 * off the running instance.
 */
describe("the identifier fallback crosses from the plugin to the read", () => {
	let payload: Payload;

	beforeAll(async () => {
		payload = await bootPayload({
			key: "wayfinder-identifier-fallback",
			localized: false,
			fallbackIdentifierField: "handle",
		});

		await payload.updateGlobal({
			slug: "collections-mapping",
			data: { collections: [{ collectionName: "pages", path: "/:slug" }] },
		});
	});

	it("compiles mappings with what the plugin declared", async () => {
		const mappings = await loadMappings({ payload });

		expect(mappings[0]?.fallbackIdentifierField).toBe("handle");
	});

	it("still lets a caller override it", async () => {
		const mappings = await loadMappings({
			payload,
			fallbackIdentifierField: "permalink",
		});

		expect(mappings[0]?.fallbackIdentifierField).toBe("permalink");
	});
});
