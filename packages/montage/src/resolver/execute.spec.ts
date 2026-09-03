import { afterEach, describe, expect, it, vi } from "vitest";

import { createBlockContext } from "../context.js";
import { checkIdentity, getBlockData, resolveBlockData } from "./execute.js";

import type { InternalBlockEntry } from "../types.js";

const entry = (
	args: Partial<InternalBlockEntry> & { slug: string },
): InternalBlockEntry => ({
	expands: false,
	component: () => null,
	...args,
});

const setNodeEnv = (value: string | undefined): void => {
	if (value === undefined) {
		vi.unstubAllEnvs();
	} else {
		vi.stubEnv("NODE_ENV", value);
	}
};

describe("resolveBlockData", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("resolves a block found in the tree and stores the result by identity", async () => {
		const node = { blockType: "hero", id: "1" };
		const root = { sections: [node] };
		const entries = new Map([
			["hero", entry({ slug: "hero", resolve: () => ({ n: 1 }) })],
		]);
		const ctx = createBlockContext({});

		await resolveBlockData({ root, ctx, entries });

		expect(getBlockData(ctx, node)).toEqual({ n: 1 });
	});

	it("scope: root checks only the root node and ignores nested blocks", async () => {
		const nested = { blockType: "hero", id: "nested" };
		const root = { blockType: "template", id: "root", sections: [nested] };
		const entries = new Map([
			[
				"template",
				entry({ slug: "template", resolve: () => ({ meta: true }) }),
			],
			["hero", entry({ slug: "hero", resolve: () => ({ n: 1 }) })],
		]);
		const ctx = createBlockContext({});

		await resolveBlockData({ root, ctx, entries, scope: "root" });

		expect(getBlockData(ctx, root)).toEqual({ meta: true });
		expect(getBlockData(ctx, nested)).toBeUndefined();
	});

	it("scope: root ignores expands", async () => {
		const inner = { blockType: "inner", id: "1" };
		const root = {
			blockType: "template",
			id: "root",
			payload: { list: [inner] },
		};
		const entries = new Map([
			[
				"template",
				entry({
					slug: "template",
					expands: true,
					resolve: () => ({ list: [inner] }),
				}),
			],
			["inner", entry({ slug: "inner", resolve: () => ({ done: true }) })],
		]);
		const ctx = createBlockContext({});

		await resolveBlockData({ root, ctx, entries, scope: "root" });

		expect(getBlockData(ctx, root)).toBeDefined();
		expect(getBlockData(ctx, inner)).toBeUndefined();
	});

	it("does not traverse into a non-expands resolver's result", async () => {
		const projectA = { blockType: "module-inside-project", id: "a" };
		const project = { title: "Project", layout: [projectA] };
		const root = { blockType: "slider", id: "1" };
		const entries = new Map([
			[
				"slider",
				entry({ slug: "slider", resolve: () => ({ projects: [project] }) }),
			],
			[
				"module-inside-project",
				entry({
					slug: "module-inside-project",
					resolve: () => ({ shouldNotRun: true }),
				}),
			],
		]);
		const ctx = createBlockContext({});

		await resolveBlockData({ root, ctx, entries });

		expect(getBlockData(ctx, root)).toEqual({ projects: [project] });
		expect(getBlockData(ctx, projectA)).toBeUndefined();
	});

	it("traverses into an expands resolver's result, and the frontier iterates", async () => {
		const level2 = { blockType: "level2", id: "l2" };
		const level1 = { blockType: "level1", id: "l1" };
		const root = { blockType: "root-block", id: "root" };
		const entries = new Map([
			[
				"root-block",
				entry({ slug: "root-block", expands: true, resolve: () => level1 }),
			],
			[
				"level1",
				entry({ slug: "level1", expands: true, resolve: () => level2 }),
			],
			["level2", entry({ slug: "level2", resolve: () => ({ leaf: true }) })],
		]);
		const ctx = createBlockContext({});

		await resolveBlockData({ root, ctx, entries });

		expect(getBlockData(ctx, level2)).toEqual({ leaf: true });
	});

	it("accumulates: a scope root call followed by a scope tree call runs the root resolver once, but still expands its stored result", async () => {
		const nested = { blockType: "hero", id: "nested" };
		const root = { blockType: "template", id: "root" };
		const rootResolve = vi.fn(() => ({ layout: [nested] }));
		const entries = new Map([
			[
				"template",
				entry({ slug: "template", expands: true, resolve: rootResolve }),
			],
			["hero", entry({ slug: "hero", resolve: () => ({ n: 1 }) })],
		]);
		const ctx = createBlockContext({});

		await resolveBlockData({ root, ctx, entries, scope: "root" });
		expect(rootResolve).toHaveBeenCalledTimes(1);
		expect(getBlockData(ctx, nested)).toBeUndefined();

		await resolveBlockData({ root, ctx, entries, scope: "tree" });
		// still once: dedup
		expect(rootResolve).toHaveBeenCalledTimes(1);
		// but its stored result was expanded
		expect(getBlockData(ctx, nested)).toEqual({ n: 1 });
	});

	it("a rejected resolver leaves undefined data and does not fail the pass", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const node = { blockType: "hero", id: "1" };
		const root = { sections: [node] };
		const entries = new Map([
			[
				"hero",
				entry({
					slug: "hero",
					resolve: async () => await Promise.reject(new Error("boom")),
				}),
			],
		]);
		const ctx = createBlockContext({});

		await expect(
			resolveBlockData({ root, ctx, entries }),
		).resolves.toBeUndefined();
		expect(getBlockData(ctx, node)).toBeUndefined();
	});

	it("logs a rejected resolver in development but not in production", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const node = { blockType: "hero", id: "1" };
		const entries = new Map([
			[
				"hero",
				entry({
					slug: "hero",
					resolve: async () => await Promise.reject(new Error("boom")),
				}),
			],
		]);

		setNodeEnv("development");
		await resolveBlockData({
			root: { sections: [node] },
			ctx: createBlockContext({}),
			entries,
		});
		expect(spy).toHaveBeenCalled();

		spy.mockClear();
		setNodeEnv("production");
		await resolveBlockData({
			root: { sections: [node] },
			ctx: createBlockContext({}),
			entries,
		});
		expect(spy).not.toHaveBeenCalled();
	});

	it("maxPasses overflow throws in development", async () => {
		setNodeEnv("development");
		const chain = (n: number): InternalBlockEntry =>
			entry({
				slug: `step-${String(n)}`,
				expands: true,
				resolve: () => ({
					blockType: `step-${String(n + 1)}`,
					id: String(n + 1),
				}),
			});
		const entries = new Map([
			["step-0", chain(0)],
			["step-1", chain(1)],
			["step-2", chain(2)],
			["step-3", chain(3)],
		]);
		const root = { blockType: "step-0", id: "0" };
		const ctx = createBlockContext({});

		await expect(
			resolveBlockData({ root, ctx, entries, maxPasses: 2 }),
		).rejects.toThrow(/maxPasses/);
	});

	it("maxPasses overflow warns and stops in production", async () => {
		setNodeEnv("production");
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const chain = (n: number): InternalBlockEntry =>
			entry({
				slug: `step-${String(n)}`,
				expands: true,
				resolve: () => ({
					blockType: `step-${String(n + 1)}`,
					id: String(n + 1),
				}),
			});
		const entries = new Map([
			["step-0", chain(0)],
			["step-1", chain(1)],
			["step-2", chain(2)],
			["step-3", chain(3)],
		]);
		const root = { blockType: "step-0", id: "0" };
		const ctx = createBlockContext({});

		await expect(
			resolveBlockData({ root, ctx, entries, maxPasses: 2 }),
		).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
	});

	it("does not collide when a resolver's result shares a blockType with a node in root", async () => {
		const inRoot = { blockType: "hero", id: "root-hero" };
		const inResult = { blockType: "hero", id: "result-hero" };
		const root = { blockType: "slider", id: "1", visible: [inRoot] };
		const entries = new Map([
			[
				"slider",
				entry({ slug: "slider", expands: true, resolve: () => inResult }),
			],
			["hero", entry({ slug: "hero", resolve: () => ({ tag: "resolved" }) })],
		]);
		const ctx = createBlockContext({});

		await resolveBlockData({ root, ctx, entries });

		expect(getBlockData(ctx, inRoot)).toEqual({ tag: "resolved" });
		expect(getBlockData(ctx, inResult)).toEqual({ tag: "resolved" });
	});
});

describe("checkIdentity", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("warns in development when a node with a registered resolver has no stored data", () => {
		setNodeEnv("development");
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const entries = new Map([
			["hero", entry({ slug: "hero", resolve: () => ({ n: 1 }) })],
		]);
		const ctx = createBlockContext({});

		checkIdentity(ctx, { blockType: "hero", id: "1" }, entries);

		expect(spy).toHaveBeenCalled();
	});

	it("does not warn in production", () => {
		setNodeEnv("production");
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const entries = new Map([
			["hero", entry({ slug: "hero", resolve: () => ({ n: 1 }) })],
		]);
		const ctx = createBlockContext({});

		checkIdentity(ctx, { blockType: "hero", id: "1" }, entries);

		expect(spy).not.toHaveBeenCalled();
	});

	it("does not warn for a block with no registered resolver", () => {
		setNodeEnv("development");
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		// no resolve
		const entries = new Map([["hero", entry({ slug: "hero" })]]);
		const ctx = createBlockContext({});

		checkIdentity(ctx, { blockType: "hero", id: "1" }, entries);

		expect(spy).not.toHaveBeenCalled();
	});

	it("does not warn once the node is actually resolved", async () => {
		setNodeEnv("development");
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const node = { blockType: "hero", id: "1" };
		const entries = new Map([
			["hero", entry({ slug: "hero", resolve: () => ({ n: 1 }) })],
		]);
		const ctx = createBlockContext({});

		await resolveBlockData({ root: { sections: [node] }, ctx, entries });
		checkIdentity(ctx, node, entries);

		expect(spy).not.toHaveBeenCalled();
	});
});

describe("getBlockData", () => {
	it("returns undefined for a block spread after resolution (identity mismatch)", async () => {
		const node = { blockType: "hero", id: "1" };
		const entries = new Map([
			["hero", entry({ slug: "hero", resolve: () => ({ n: 1 }) })],
		]);
		const ctx = createBlockContext({});

		await resolveBlockData({ root: { sections: [node] }, ctx, entries });

		const cloned = { ...node };
		expect(getBlockData(ctx, cloned)).toBeUndefined();
		expect(getBlockData(ctx, node)).toEqual({ n: 1 });
	});
});
