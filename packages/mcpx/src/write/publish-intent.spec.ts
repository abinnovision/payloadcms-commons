import { describe, expect, it } from "vitest";

import {
	claimPublishIntent,
	isClaimedPublish,
	withPublishIntent,
} from "./publish-intent.js";

const PAGE = { kind: "collection", slug: "pages", id: 1 } as const;

describe("publish intent", () => {
	it("is absent outside a publish", () => {
		expect(claimPublishIntent(PAGE)).toBe(false);
		expect(isClaimedPublish("collection", "pages")).toBe(false);
	});

	it("is claimed once and only by the operation it names", async () => {
		await withPublishIntent(PAGE, () => {
			expect(claimPublishIntent({ ...PAGE, slug: "posts" })).toBe(false);
			expect(claimPublishIntent({ ...PAGE, id: 2 })).toBe(false);
			expect(claimPublishIntent({ ...PAGE, kind: "global" })).toBe(false);
			expect(claimPublishIntent(PAGE)).toBe(true);
			// A re-entrant write to the same document cannot ride along.
			expect(claimPublishIntent(PAGE)).toBe(false);

			return Promise.resolve();
		});
	});

	it("only reports a claimed publish to the change hook", async () => {
		await withPublishIntent(PAGE, () => {
			expect(isClaimedPublish("collection", "pages")).toBe(false);

			claimPublishIntent(PAGE);

			expect(isClaimedPublish("collection", "pages")).toBe(true);
			expect(isClaimedPublish("collection", "posts")).toBe(false);
			expect(isClaimedPublish("global", "pages")).toBe(false);

			return Promise.resolve();
		});
	});

	it("stays inside its own async context", async () => {
		const sibling = withPublishIntent(
			{ kind: "global", slug: "site-settings" },
			async () => {
				await Promise.resolve();

				return claimPublishIntent(PAGE);
			},
		);

		await expect(sibling).resolves.toBe(false);
		expect(claimPublishIntent(PAGE)).toBe(false);
	});

	it("does not outlive the publish", async () => {
		await withPublishIntent(PAGE, () => Promise.resolve());

		expect(claimPublishIntent(PAGE)).toBe(false);
	});
});
