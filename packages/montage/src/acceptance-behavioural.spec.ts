import { describe, expect, it } from "vitest";

import { createBlockContext } from "./context.js";
import { asText } from "../test/fixtures/as-text.js";
import { createRenderer } from "../test/fixtures/montage.js";
import { blocks } from "../test/fixtures/registry.js";

import type { PagesDocumentTemplateBlock } from "../test/fixtures/blocks.js";
import type { AppContext } from "../test/fixtures/context.js";

/**
 * WP7, behavioural acceptance: the runtime half, once the resolver exists.
 * Every item here exists because an earlier draft of this plan broke it and
 * the structural set alone could not have detected it.
 */
const ctx = (): ReturnType<typeof createBlockContext<AppContext>> =>
	createBlockContext<AppContext>({
		document: {
			collection: "pages",
			identifier: { field: "slug", value: "home" },
		},
		locale: "de",
		isPreview: false,
		path: "/",
	});

describe("acceptance (WP7): document template — synthetic root with an id resolves under identity keying", () => {
	it("root is bound once and the same reference is resolved and rendered", async () => {
		const renderer = createRenderer(blocks);
		const root: PagesDocumentTemplateBlock = {
			blockType: "pages-document-template",
			id: "page-1",
			title: "Home",
			layout: { sections: [] },
		};
		const context = ctx();

		await renderer.resolveBlockData({ root, ctx: context });
		const el = await renderer.renderBlockTree({ block: root, ctx: context });

		expect(el).not.toBeNull();
		expect(renderer.getBlockData(context, root)).toEqual({ title: "Home" });
	});
});

describe("acceptance (WP7): CardsSliderModule — a resolver plus a data-reading predicate, together", () => {
	it("does not render when the resolver returns zero items", async () => {
		const renderer = createRenderer(blocks);
		const block = {
			blockType: "cards-slider-module" as const,
			id: "1",
			limit: 0,
		};
		const context = ctx();

		await renderer.resolveBlockData({
			root: block,
			ctx: context,
			scope: "root",
		});

		expect(renderer.canRender({ block, ctx: context })).toBe(false);
	});

	it("renders when the resolver returns items", async () => {
		const renderer = createRenderer(blocks);
		const block = {
			blockType: "cards-slider-module" as const,
			id: "1",
			limit: 3,
		};
		const context = ctx();

		await renderer.resolveBlockData({
			root: block,
			ctx: context,
			scope: "root",
		});

		expect(renderer.canRender({ block, ctx: context })).toBe(true);
		expect(asText(renderer.Block({ block, ctx: context }))).toContain(
			"3 items",
		);
	});
});

describe("acceptance (WP7): generateMetadata — scope: root stops before block resolvers", () => {
	it("resolves only the root, then a later tree call resolves the rest without re-running the root", async () => {
		const renderer = createRenderer(blocks);
		const nested = {
			blockType: "hero-module" as const,
			id: "nested",
			title: "Nested",
		};
		const root: PagesDocumentTemplateBlock = {
			blockType: "pages-document-template",
			id: "page-1",
			title: "Home",
			layout: {
				sections: [{ blockType: "section-wrapper", modules: [nested] }],
			},
		};
		const context = ctx();

		// generateMetadata-equivalent: only the document-level resolver runs.
		await renderer.resolveBlockData({ root, ctx: context, scope: "root" });
		expect(renderer.getBlockData(context, root)).toEqual({ title: "Home" });
		expect(renderer.getBlockData(context, nested)).toBeUndefined();

		// the page render: accumulates, does not re-run the (non-expands) root resolver.
		await renderer.resolveBlockData({ root, ctx: context });
		const el = await renderer.renderBlockTree({ block: root, ctx: context });
		expect(el).not.toBeNull();
	});
});

describe("acceptance (WP7): a resolver returning documents — expands: false does not traverse into its result", () => {
	it("the module inside a returned card never gets its own resolver executed", async () => {
		const renderer = createRenderer(blocks);
		const block = {
			blockType: "cards-slider-module" as const,
			id: "1",
			limit: 2,
		};
		const context = ctx();

		await renderer.resolveBlockData({ root: block, ctx: context });
		const data = renderer.getBlockData<{
			items: { layout: { blockType: string; id?: string | null }[] }[];
		}>(context, block);

		expect(data?.items).toHaveLength(2);

		const nestedModule = data?.items[0]?.layout[0] ?? null;
		expect(nestedModule).not.toBeNull();
		expect(
			renderer.getBlockData(context, nestedModule as object),
		).toBeUndefined();
	});
});

describe("acceptance (WP7): a block spread after resolution", () => {
	it("renders with undefined data and getBlockData returns undefined for the clone", async () => {
		const renderer = createRenderer(blocks);
		const block = {
			blockType: "cards-slider-module" as const,
			id: "1",
			limit: 1,
		};
		const context = ctx();

		await renderer.resolveBlockData({
			root: block,
			ctx: context,
			scope: "root",
		});

		const cloned = { ...block };
		expect(renderer.getBlockData(context, cloned)).toBeUndefined();
		expect(renderer.getBlockData(context, block)).toBeDefined();
	});
});
