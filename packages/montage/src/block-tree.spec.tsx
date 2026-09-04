import { afterEach, describe, expect, it, vi } from "vitest";

import { createBlockTree } from "./block-tree.js";
import { createBlockContext } from "./context.js";
import { resolveBlockData } from "./resolver/execute.js";

import type { InternalBlockEntry } from "./types.js";

const entry = (
	args: Partial<InternalBlockEntry> & { slug: string },
): InternalBlockEntry => ({
	expands: false,
	component: () => "rendered",
	...args,
});

describe("createBlockTree", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	describe("gating order", () => {
		it("null guard: renders nothing for a null block", () => {
			const entries = new Map<string, InternalBlockEntry>();
			const { Block, canRender } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			expect(canRender({ block: null, ctx })).toBe(false);
			expect(Block({ block: null, ctx })).toBeNull();
		});

		it("registry-level canRender short-circuits before the slug is looked up", () => {
			// "hero" is NOT registered
			const entries = new Map<string, InternalBlockEntry>();
			const registryCanRender = vi.fn(() => false);
			const { canRender } = createBlockTree(entries, registryCanRender);
			const ctx = createBlockContext({});

			/*
			 * an unregistered slug hidden by the registry rule stays silent: no
			 * unknown-block warning, because evaluate() never reaches the lookup
			 */
			vi.stubEnv("NODE_ENV", "development");
			const spy = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);

			expect(canRender({ block: { blockType: "hero" }, ctx })).toBe(false);
			expect(registryCanRender).toHaveBeenCalled();
			expect(spy).not.toHaveBeenCalled();
		});

		it("registry-level canRender receives block without requiring a registered slug", () => {
			const entries = new Map([["hero", entry({ slug: "hero" })]]);
			let seenBlockType: unknown;
			const registryCanRender = ({
				block,
			}: {
				block: { blockType?: string };
			}): boolean => {
				seenBlockType = block.blockType;

				return true;
			};

			const { canRender } = createBlockTree(entries, registryCanRender);
			const ctx = createBlockContext({});

			canRender({ block: { blockType: "hero" }, ctx });
			expect(seenBlockType).toBe("hero");
		});

		it("blockType guard: renders nothing (in production) for a block with no blockType", () => {
			vi.stubEnv("NODE_ENV", "production");
			const entries = new Map<string, InternalBlockEntry>();
			const { Block } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			expect(Block({ block: {}, ctx })).toBeNull();
		});

		it("per-block canRender runs last and receives resolved data", async () => {
			const node = { blockType: "hero", id: "1" };
			const entries = new Map([
				[
					"hero",
					entry({
						slug: "hero",
						resolve: () => ({ visible: false }),
						canRender: ({ data }) => (data as { visible: boolean }).visible,
					}),
				],
			]);
			const { canRender } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			await resolveBlockData({ root: node, ctx, entries, scope: "root" });

			expect(canRender({ block: node, ctx })).toBe(false);
		});
	});

	describe("unknown-block policy", () => {
		it("block throws in development for an unregistered slug", () => {
			vi.stubEnv("NODE_ENV", "development");
			const entries = new Map<string, InternalBlockEntry>();
			const { Block } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			expect(() => Block({ block: { blockType: "missing" }, ctx })).toThrow(
				/not registered/,
			);
		});

		it("block renders nothing in production for an unregistered slug", () => {
			vi.stubEnv("NODE_ENV", "production");
			const entries = new Map<string, InternalBlockEntry>();
			const { Block } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			expect(Block({ block: { blockType: "missing" }, ctx })).toBeNull();
		});

		it("canRender returns false rather than throwing, and warns in development", () => {
			vi.stubEnv("NODE_ENV", "development");
			const spy = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);
			const entries = new Map<string, InternalBlockEntry>();
			const { canRender } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			expect(canRender({ block: { blockType: "missing" }, ctx })).toBe(false);
			expect(spy).toHaveBeenCalled();
		});

		it("canRender does not warn in production", () => {
			vi.stubEnv("NODE_ENV", "production");
			const spy = vi
				.spyOn(console, "error")
				.mockImplementation(() => undefined);
			const entries = new Map<string, InternalBlockEntry>();
			const { canRender } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			expect(canRender({ block: { blockType: "missing" }, ctx })).toBe(false);
			expect(spy).not.toHaveBeenCalled();
		});
	});

	describe("isRegistered", () => {
		it("reflects the registry", () => {
			const entries = new Map([["hero", entry({ slug: "hero" })]]);
			const { isRegistered } = createBlockTree(entries, undefined);

			expect(isRegistered("hero")).toBe(true);
			expect(isRegistered("missing")).toBe(false);
		});
	});

	describe("renderer self-injection", () => {
		it("passes itself as `renderer` into the component's args", () => {
			let receivedRenderer: unknown;
			const entries = new Map([
				[
					"hero",
					entry({
						slug: "hero",
						component: ({ renderer }) => {
							receivedRenderer = renderer;

							return "ok";
						},
					}),
				],
			]);
			const dispatch = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			void dispatch.Block({ block: { blockType: "hero" }, ctx });

			expect(receivedRenderer).toBe(dispatch);
		});

		it("two renderers built from separate registries do not share state", () => {
			const entriesA = new Map([
				["hero", entry({ slug: "hero", component: () => "a" })],
			]);
			// "hero" unregistered here
			const entriesB = new Map<string, InternalBlockEntry>();
			const rendererA = createBlockTree(entriesA, undefined);
			const rendererB = createBlockTree(entriesB, undefined);

			expect(rendererA.isRegistered("hero")).toBe(true);
			expect(rendererB.isRegistered("hero")).toBe(false);
		});
	});

	describe("wrapBlock", () => {
		it("wraps a rendered block", async () => {
			const entries = new Map([["hero", entry({ slug: "hero" })]]);
			const { renderBlockTree } = createBlockTree(
				entries,
				undefined,
				({ children }) => `[${children as string}]`,
			);
			const ctx = createBlockContext({});

			const el = await renderBlockTree({ block: { blockType: "hero" }, ctx });
			expect(el?.props).toEqual({ children: "[rendered]" });
		});

		it("receives the block and context alongside the children", async () => {
			const entries = new Map([["hero", entry({ slug: "hero" })]]);
			const wrapBlock = vi.fn(({ children }) => children);
			const { renderBlockTree } = createBlockTree(
				entries,
				undefined,
				wrapBlock,
			);
			const ctx = createBlockContext({ locale: "de" });
			const block = { blockType: "hero", id: "hero-1" };

			await renderBlockTree({ block, ctx });

			expect(wrapBlock).toHaveBeenCalledWith({
				block,
				ctx,
				children: "rendered",
			});
		});

		it("runs after gating, so a block that renders nothing is never wrapped", () => {
			/*
			 * Anything hanging a marker off the wrapper would otherwise emit one
			 * for a block the reader never sees.
			 */
			const entries = new Map([
				["hero", entry({ slug: "hero", canRender: () => false })],
			]);
			const wrapBlock = vi.fn(({ children }) => children);
			const { Block } = createBlockTree(entries, undefined, wrapBlock);
			const ctx = createBlockContext({});

			expect(Block({ block: { blockType: "hero" }, ctx })).toBeNull();
			expect(wrapBlock).not.toHaveBeenCalled();
		});

		it("wraps nested blocks too, since children dispatch through the same Block", async () => {
			const entries = new Map([
				[
					"section",
					entry({
						slug: "section",
						component: ({ ctx, renderer }) =>
							renderer.Block({ block: { blockType: "hero" }, ctx }),
					}),
				],
				["hero", entry({ slug: "hero" })],
			]);
			const { renderBlockTree } = createBlockTree(
				entries,
				undefined,
				({ block, children }) =>
					`<${String(block.blockType)}>${children as string}`,
			);
			const ctx = createBlockContext({});

			const el = await renderBlockTree({
				block: { blockType: "section" },
				ctx,
			});
			expect(el?.props).toEqual({
				children: "<section><hero>rendered",
			});
		});

		it("is inert when not supplied", async () => {
			const entries = new Map([["hero", entry({ slug: "hero" })]]);
			const { renderBlockTree } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			const el = await renderBlockTree({ block: { blockType: "hero" }, ctx });
			expect(el?.props).toEqual({ children: "rendered" });
		});
	});

	describe("renderBlockTree", () => {
		it("returns null when the component itself returns null", async () => {
			const entries = new Map([
				["hero", entry({ slug: "hero", component: () => null })],
			]);
			const { renderBlockTree } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			expect(
				await renderBlockTree({ block: { blockType: "hero" }, ctx }),
			).toBeNull();
		});

		it("returns null for an unregistered slug in production", async () => {
			vi.stubEnv("NODE_ENV", "production");
			const entries = new Map<string, InternalBlockEntry>();
			const { renderBlockTree } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			expect(
				await renderBlockTree({ block: { blockType: "missing" }, ctx }),
			).toBeNull();
		});

		it("awaits an async component and returns a walkable element", async () => {
			const entries = new Map([
				[
					"hero",
					entry({
						slug: "hero",
						component: async ({ block }) => {
							await Promise.resolve();

							return `hello ${(block as { title: string }).title}`;
						},
					}),
				],
			]);
			const { renderBlockTree } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			const el = await renderBlockTree({
				block: { blockType: "hero", title: "world" },
				ctx,
			});

			expect(el).not.toBeNull();
			expect(el?.props).toBeDefined();
		});

		it("wraps a real React element result unchanged", async () => {
			const entries = new Map([
				[
					"hero",
					entry({
						slug: "hero",
						component: () => ({ type: "div", props: {}, key: null }),
					}),
				],
			]);
			const { renderBlockTree } = createBlockTree(entries, undefined);
			const ctx = createBlockContext({});

			const el = await renderBlockTree({ block: { blockType: "hero" }, ctx });
			expect(el).toEqual({ type: "div", props: {}, key: null });
		});
	});
});
