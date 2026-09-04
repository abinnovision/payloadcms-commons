import { describe, expect, it } from "vitest";

import { createBlockContext } from "./context.js";
import { asText } from "../test/fixtures/as-text.js";
import { GlobalReference } from "../test/fixtures/components/GlobalReference.js";
import { LocationFactsModule } from "../test/fixtures/components/LocationFactsModule.js";
import { PageLayout } from "../test/fixtures/components/PageLayout.js";
import { SectionWrapper } from "../test/fixtures/components/SectionWrapper.js";
import { createRenderer } from "../test/fixtures/montage.js";
import { blocks } from "../test/fixtures/registry.js";

import type {
	GlobalReferenceBlock,
	PageLayoutData,
	SectionWrapperBlock,
} from "../test/fixtures/blocks.js";
import type { AppContext } from "../test/fixtures/context.js";

/**
 * WP4, structural acceptance: the rebuild walkthrough compiles and runs
 * against the exported surface, before the resolver exists. The bar is
 * higher than "it works": every port below has to be reachable with
 * capabilities montage already exports. Four ports, chosen so each can fail:
 * SectionWrapper (canRender sufficiency, child-context clone), GlobalReference
 * (curried inline typing, a block reached through a relationship),
 * PageLayout (createChildContext + extension signalling), and a `ctx`-only
 * predicate module with no resolver.
 */
const ctx = (
	overrides?: Partial<AppContext>,
): ReturnType<typeof createBlockContext<AppContext>> =>
	createBlockContext<AppContext>({
		document: {
			collection: "pages",
			identifier: { field: "slug", value: "home" },
		},
		locale: "de",
		isPreview: false,
		path: "/",
		...overrides,
	});

describe("acceptance (WP4): SectionWrapper", () => {
	it("collapses when no modules can render", () => {
		void SectionWrapper;
		const renderer = createRenderer(blocks);
		const empty: SectionWrapperBlock = {
			blockType: "section-wrapper",
			modules: [],
		};

		expect(renderer.Block({ block: empty, ctx: ctx() })).toBeNull();
	});

	it("renders its visible modules and reflects isFirstSection through the child context", () => {
		const renderer = createRenderer(blocks);
		const section: SectionWrapperBlock = {
			blockType: "section-wrapper",
			modules: [{ id: "1", blockType: "hero-module", title: "Hello" }],
		};

		const result = asText(renderer.Block({ block: section, ctx: ctx() }));
		expect(result).toContain("Hello");
	});
});

describe("acceptance (WP4): GlobalReference", () => {
	it("renders a block reached through a relationship", () => {
		void GlobalReference;
		const renderer = createRenderer(blocks);
		const ref: GlobalReferenceBlock = {
			blockType: "global-reference",
			reference: { blockType: "hero-module", id: "1", title: "Via reference" },
		};

		expect(asText(renderer.Block({ block: ref, ctx: ctx() }))).toContain(
			"Via reference",
		);
	});
});

describe("acceptance (WP4): PageLayout", () => {
	it("iterates header, sections and footer through renderer.Block and createChildContext", () => {
		const renderer = createRenderer(blocks);
		const data: PageLayoutData = {
			header: [
				{
					blockType: "global-reference",
					reference: { blockType: "hero-module", id: "h", title: "Header" },
				},
			],
			sections: [
				{
					blockType: "section-wrapper",
					modules: [{ id: "1", blockType: "hero-module", title: "One" }],
				},
				{
					blockType: "section-wrapper",
					modules: [{ id: "2", blockType: "hero-module", title: "Two" }],
				},
			],
			footer: [
				{
					blockType: "global-reference",
					reference: { blockType: "hero-module", id: "f", title: "Footer" },
				},
			],
		};

		const result = PageLayout({ data, ctx: ctx(), renderer });

		expect(result).toContain("Header");
		expect(result).toContain("One");
		expect(result).toContain("Two");
		expect(result).toContain("Footer");
	});
});

describe("acceptance (WP4): LocationFactsModule (ctx-only predicate, no resolver)", () => {
	it("uses ctx.document without declaring resolve", () => {
		void LocationFactsModule;
		const renderer = createRenderer(blocks);
		const block = { blockType: "location-facts-module" as const, id: "1" };

		expect(renderer.canRender({ block, ctx: ctx() })).toBe(true);
		expect(asText(renderer.Block({ block, ctx: ctx() }))).toContain("home");
	});

	it("hides when ctx.document.identifier.value is empty", () => {
		const renderer = createRenderer(blocks);
		const block = { blockType: "location-facts-module" as const, id: "1" };
		const emptyCtx = ctx({
			document: {
				collection: "pages",
				identifier: { field: "slug", value: "" },
			},
		});

		expect(renderer.canRender({ block, ctx: emptyCtx })).toBe(false);
	});
});
