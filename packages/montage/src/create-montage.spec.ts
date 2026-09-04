import { describe, expect, it } from "vitest";

import { createBlockContext } from "./context.js";
import { createMontage } from "./create-montage.js";
/*
 * Augments `GeneratedTypes` for the whole package's compilation. Loaded here
 * purely for its ambient `declare module "payload"` side effect;
 * `test/fixtures/blocks.ts` is the single canonical augmentation site, since
 * ambient augmentation is program-wide and a second, differently-shaped
 * declaration would collide with it rather than layer on top.
 */
import "../test/fixtures/blocks.js";

/**
 * These are also compile-time fixtures. Every `@ts-expect-error` below is
 * load-bearing: removing one and re-running `tsc --noEmit` must reintroduce
 * the type error it silences.
 */
interface MyContext {
	locale: string;
	document: { collection: string };
}

describe("createMontage", () => {
	it("binds TCtx once, so ctx carries the consumer's own fields", () => {
		const { defineBlockComponent } = createMontage<MyContext>();

		const HeroModule = defineBlockComponent("hero-module", {
			component: ({ block, ctx }) =>
				`${block.title}/${ctx.document.collection}`,
		});

		expect(HeroModule.slug).toBe("hero-module");
	});

	it("infers D from resolve, sync and async, and passes it to canRender/component", () => {
		const { defineBlockComponent } = createMontage<MyContext>();

		const sync = defineBlockComponent("hero-module", {
			resolve: ({ block }) => ({ len: block.title.length }),
			canRender: ({ data }) => data.len > 0,
			component: ({ data }) => `len:${String(data.len)}`,
		});

		const withAsync = defineBlockComponent("hero-module", {
			resolve: async ({ block }) =>
				await Promise.resolve({ len: block.title.length }),
			component: ({ data }) => `len:${String(data.len)}`,
		});

		expect(sync.slug).toBe("hero-module");
		expect(withAsync.slug).toBe("hero-module");
	});

	it("rejects a typo'd slug at defineBlockComponent", () => {
		const { defineBlockComponent } = createMontage<MyContext>();

		expect(() => {
			// @ts-expect-error -- "hero-modul" is not a BlockSlug
			defineBlockComponent("hero-modul", { component: () => null });
		}).not.toThrow();
	});

	it("the curried inline factory infers D once TBlock is explicit", () => {
		const { defineInlineBlockComponent } = createMontage<MyContext>();
		interface SectionWrapperBlock {
			blockType: "section-wrapper";
			modules: { id: string; blockType: string }[];
		}

		const SectionWrapper = defineInlineBlockComponent<SectionWrapperBlock>()(
			"section-wrapper",
			{
				resolve: ({ block }) => ({ count: block.modules.length }),
				component: ({ data }) => `count:${String(data.count)}`,
			},
		);

		expect(SectionWrapper.slug).toBe("section-wrapper");
	});

	it("rejects a typo'd inline slug against the block's own blockType literal", () => {
		const { defineInlineBlockComponent } = createMontage<MyContext>();
		interface SectionWrapperBlock {
			blockType: "section-wrapper";
		}

		expect(() => {
			// @ts-expect-error -- "section-wrappr" is not SectionWrapperBlock["blockType"]
			defineInlineBlockComponent<SectionWrapperBlock>()("section-wrappr", {
				component: () => null,
			});
		}).not.toThrow();
	});

	describe("defineBlockRegistry", () => {
		it("accepts a correctly keyed registry", () => {
			const { defineBlockComponent, defineBlockRegistry } =
				createMontage<MyContext>();
			const HeroModule = defineBlockComponent("hero-module", {
				component: () => null,
			});

			const registry = defineBlockRegistry(
				{ "hero-module": HeroModule },
				{ require: ["hero-module"] },
			);

			expect(registry).toBeDefined();
		});

		it("accepts a registry built from a pre-typed variable, not an inline literal", () => {
			const { defineBlockComponent, defineBlockRegistry } =
				createMontage<MyContext>();
			const HeroModule = defineBlockComponent("hero-module", {
				component: () => null,
			});
			const NumbersGrid = defineBlockComponent("numbers-grid-module", {
				component: () => null,
			});

			const entries = {
				"hero-module": HeroModule,
				"numbers-grid-module": NumbersGrid,
			} as const;

			const registry = defineBlockRegistry(entries, {
				require: ["hero-module"],
			});
			expect(registry).toBeDefined();
		});

		it("rejects a component registered under the wrong key", () => {
			const { defineBlockComponent, defineBlockRegistry } =
				createMontage<MyContext>();
			const HeroModule = defineBlockComponent("hero-module", {
				component: () => null,
			});

			expect(() => {
				defineBlockRegistry({
					// @ts-expect-error -- HeroModule's slug is "hero-module", not "numbers-grid-module"
					"numbers-grid-module": HeroModule,
				});
			}).not.toThrow();
		});

		it("rejects the same component registered under two keys", () => {
			const { defineBlockComponent, defineBlockRegistry } =
				createMontage<MyContext>();
			const HeroModule = defineBlockComponent("hero-module", {
				component: () => null,
			});

			expect(() => {
				defineBlockRegistry({
					"hero-module": HeroModule,
					// @ts-expect-error -- HeroModule's slug does not match "hero-alias"
					"hero-alias": HeroModule,
				});
			}).not.toThrow();
		});

		it("rejects a `require` entry that is not a registered key", () => {
			const { defineBlockComponent, defineBlockRegistry } =
				createMontage<MyContext>();
			const HeroModule = defineBlockComponent("hero-module", {
				component: () => null,
			});

			expect(() => {
				defineBlockRegistry(
					{ "hero-module": HeroModule },
					// @ts-expect-error -- "numbers-grid-module" is not a key of entries
					{ require: ["numbers-grid-module"] },
				);
			}).not.toThrow();
		});

		it("registry-level canRender receives an optional blockType, ahead of the guard", () => {
			const { defineBlockComponent, defineBlockRegistry } =
				createMontage<MyContext>();
			const HeroModule = defineBlockComponent("hero-module", {
				component: () => null,
			});

			const registry = defineBlockRegistry(
				{ "hero-module": HeroModule },
				{
					canRender: ({ block }) => {
						// @ts-expect-error -- blockType is optional here
						const _mustBeString: string = block.blockType;

						return block.blockType !== undefined;
					},
				},
			);

			expect(registry).toBeDefined();
		});
	});

	describe("createRenderer", () => {
		it("round-trips through Block and renderBlockTree", async () => {
			const { defineBlockComponent, defineBlockRegistry, createRenderer } =
				createMontage<MyContext>();
			const HeroModule = defineBlockComponent("hero-module", {
				component: ({ block }) => block.title,
			});
			const registry = defineBlockRegistry({ "hero-module": HeroModule });
			const renderer = createRenderer(registry);
			const ctx = createBlockContext<MyContext>({
				locale: "de",
				document: { collection: "pages" },
			});

			const el = await renderer.renderBlockTree({
				block: { blockType: "hero-module", id: "1", title: "Hello" },
				ctx,
			});

			expect(el).not.toBeNull();
		});
	});
});
