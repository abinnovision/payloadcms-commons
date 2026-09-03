import { describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";
import { createBlockContext } from "../../src/context.js";
import { createMontage } from "../../src/create-montage.js";

import type {
	HeroModuleBlock,
	RelatedPageModuleBlock,
} from "../fixtures/blocks.js";
import type { Payload } from "payload";

/*
 * Program-wide augmentation from test/fixtures/blocks.ts also applies here
 * (ambient `declare module` is per-compilation, not per-file), which is why
 * "hero-module" / "related-page-module" below type-check without a cast.
 */

interface AppContext {
	payload: Payload;
}

describe("montage against a real Payload instance (sqlite)", () => {
	it("sanitizes a config built from montagePlugin and boots", async () => {
		const payload = await bootPayload();
		expect((payload.config.blocks ?? []).map((b) => b.slug)).toContain(
			"hero-module",
		);
	});

	it("resolves a block round-tripped through payload.create/findByID, keyed by the fetched object's identity", async () => {
		const payload = await bootPayload();
		const { defineBlockComponent, defineBlockRegistry, createRenderer } =
			createMontage<AppContext>();

		const HeroModule = defineBlockComponent("hero-module", {
			resolve: ({ block }) => ({ shout: `${block.title}!` }),
			component: ({ data }) => data.shout,
		});
		const registry = defineBlockRegistry({ "hero-module": HeroModule });
		const renderer = createRenderer(registry);

		const created = await payload.create({
			collection: "pages",
			data: {
				title: "Home",
				layout: [{ blockType: "hero-module", title: "Hello" }],
			},
		});

		const fetched = await payload.findByID({
			collection: "pages",
			id: created.id,
			depth: 0,
		});
		const heroBlock = (fetched.layout as unknown as HeroModuleBlock[])[0];
		expect(heroBlock).toBeDefined();

		const ctx = createBlockContext<AppContext>({ payload });
		await renderer.resolveBlockData({ root: fetched, ctx });

		expect(renderer.getBlockData(ctx, heroBlock as object)).toEqual({
			shout: "Hello!",
		});
	});

	it("traversal reaches a depth-populated relationship value", async () => {
		const payload = await bootPayload();
		const target = await payload.create({
			collection: "pages",
			data: { title: "Target" },
		});
		const referencing = await payload.create({
			collection: "pages",
			data: {
				title: "Referencing",
				layout: [{ blockType: "related-page-module", page: target.id }],
			},
		});

		const fetched = await payload.findByID({
			collection: "pages",
			id: referencing.id,
			depth: 2,
		});
		const relatedBlock = (
			fetched.layout as unknown as RelatedPageModuleBlock[]
		)[0];
		expect(relatedBlock).toBeDefined();
		expect(typeof relatedBlock?.page).toBe("object");

		let sawRelatedPageResolver = false;
		const { defineBlockComponent, defineBlockRegistry, createRenderer } =
			createMontage<AppContext>();

		const RelatedPageModule = defineBlockComponent("related-page-module", {
			resolve: () => {
				sawRelatedPageResolver = true;

				return undefined;
			},
			component: () => null,
		});
		const registry = defineBlockRegistry({
			"related-page-module": RelatedPageModule,
		});
		const renderer = createRenderer(registry);
		const ctx = createBlockContext<AppContext>({ payload });

		await renderer.resolveBlockData({ root: fetched, ctx });

		expect(sawRelatedPageResolver).toBe(true);
	});
});
