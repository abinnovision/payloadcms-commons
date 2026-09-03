import { describe, expect, it } from "vitest";

import { planPass, planRootOnly } from "./plan.js";

import type { InternalBlockEntry } from "../types.js";

const entry = (
	slug: string,
	resolve?: InternalBlockEntry["resolve"],
): InternalBlockEntry => ({
	slug,
	expands: false,
	resolve,
	component: () => null,
});

const noResolved = { has: () => false };

describe("planPass", () => {
	it("finds a blockType-bearing node reachable from the frontier", () => {
		const resolve = () => ({ ok: true });
		const entries = new Map([["hero", entry("hero", resolve)]]);
		const root = { layout: { sections: [{ blockType: "hero", id: "1" }] } };

		const executions = planPass([root], entries, noResolved);

		expect(executions).toHaveLength(1);
		expect(executions[0]?.node).toBe(root.layout.sections[0]);
	});

	it("descends arrays, plain objects, and populated relationship values alike", () => {
		const resolve = () => undefined;
		const entries = new Map([["hero", entry("hero", resolve)]]);
		/*
		 * simulates a depth-populated relationship: a full related document nested
		 * inside a plain field, not a `blocks` array
		 */
		const root = {
			relationField: {
				relatedDoc: { nested: [{ blockType: "hero", id: "deep" }] },
			},
		};

		const executions = planPass([root], entries, noResolved);
		expect(executions).toHaveLength(1);
	});

	it("descends into a richtext-shaped subtree", () => {
		const resolve = () => undefined;
		const entries = new Map([["hero", entry("hero", resolve)]]);
		const root = {
			richContent: {
				root: {
					children: [
						{ type: "block", fields: { blockType: "hero", id: "rt-1" } },
					],
				},
			},
		};

		const executions = planPass([root], entries, noResolved);
		expect(executions).toHaveLength(1);
	});

	it("skips a node with no registered resolver", () => {
		// no resolve
		const entries = new Map([["hero", entry("hero")]]);
		const root = { blockType: "hero", id: "1" };

		expect(planPass([root], entries, noResolved)).toHaveLength(0);
	});

	it("skips a node with an unregistered slug", () => {
		const entries = new Map<string, InternalBlockEntry>();
		const root = { blockType: "unknown", id: "1" };

		expect(planPass([root], entries, noResolved)).toHaveLength(0);
	});

	it("skips a node already in alreadyResolved (dedup)", () => {
		const resolve = () => undefined;
		const entries = new Map([["hero", entry("hero", resolve)]]);
		const node = { blockType: "hero", id: "1" };
		const alreadyResolved = { has: (n: object) => n === node };

		expect(planPass([node], entries, alreadyResolved)).toHaveLength(0);
	});

	it("handles circular structures without infinite recursion", () => {
		const resolve = () => undefined;
		const entries = new Map([["hero", entry("hero", resolve)]]);
		const node: Record<string, unknown> = { blockType: "hero", id: "1" };
		node["self"] = node;

		expect(planPass([node], entries, noResolved)).toHaveLength(1);
	});

	it("does not resolve the same node twice when reachable via two paths", () => {
		const resolve = () => undefined;
		const entries = new Map([["hero", entry("hero", resolve)]]);
		const shared = { blockType: "hero", id: "1" };
		const root = { a: shared, b: shared };

		expect(planPass([root], entries, noResolved)).toHaveLength(1);
	});
});

describe("planRootOnly", () => {
	it("checks only the root node", () => {
		const resolve = () => undefined;
		const entries = new Map([["hero", entry("hero", resolve)]]);
		const root = {
			blockType: "hero",
			id: "1",
			nested: { blockType: "hero", id: "2" },
		};

		const executions = planRootOnly(root, entries, noResolved);
		expect(executions).toHaveLength(1);
		expect(executions[0]?.node).toBe(root);
	});

	it("returns nothing for a root with no blockType", () => {
		const entries = new Map<string, InternalBlockEntry>();
		expect(planRootOnly({ notABlock: true }, entries, noResolved)).toHaveLength(
			0,
		);
	});

	it("returns nothing when the root is already resolved", () => {
		const resolve = () => undefined;
		const entries = new Map([["hero", entry("hero", resolve)]]);
		const root = { blockType: "hero", id: "1" };
		const alreadyResolved = { has: () => true };

		expect(planRootOnly(root, entries, alreadyResolved)).toHaveLength(0);
	});
});
