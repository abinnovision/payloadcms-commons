import { describe, expect, it } from "vitest";

import {
	BLOCK_ID_ATTRIBUTE,
	BLOCK_TYPE_ATTRIBUTE,
	FIELD_ATTRIBUTE,
} from "../attributes.js";
import { resolveTarget } from "./target.js";

import type { TargetElement } from "./target.js";

/**
 * A tree of the three `Element` members `resolveTarget` uses, so the walk-up
 * logic is testable without a layout engine. Attribute selectors are matched
 * by name only, which is all `resolveTarget` ever asks for.
 */
class FakeElement implements TargetElement {
	public parent: FakeElement | null = null;

	public constructor(
		public readonly name: string,
		private readonly attributes: Readonly<Record<string, string>> = {},
	) {}

	public child(child: FakeElement): FakeElement {
		child.parent = this;

		return child;
	}

	public getAttribute(name: string): string | null {
		return this.attributes[name] ?? null;
	}

	public closest(selector: string): TargetElement | null {
		const attribute = selector.slice(1, -1);
		let node: FakeElement | null = this.self();
		while (node !== null) {
			if (node.getAttribute(attribute) !== null) {
				return node;
			}

			node = node.parent;
		}

		return null;
	}

	private self(): this {
		return this;
	}
}

const block = (id: string, blockType?: string): FakeElement =>
	new FakeElement(
		`block:${id}`,
		blockType === undefined
			? { [BLOCK_ID_ATTRIBUTE]: id }
			: { [BLOCK_ID_ATTRIBUTE]: id, [BLOCK_TYPE_ATTRIBUTE]: blockType },
	);

const field = (name: string): FakeElement =>
	new FakeElement(`field:${name}`, { [FIELD_ATTRIBUTE]: name });

describe("resolveTarget", () => {
	it("returns undefined outside any marked block", () => {
		expect(resolveTarget(new FakeElement("footer"))).toBeUndefined();
		expect(resolveTarget(null)).toBeUndefined();
	});

	it("resolves the nearest marked block", () => {
		const outer = block("sec-a", "section");
		const inner = outer.child(block("hero-1", "hero"));
		const text = inner.child(new FakeElement("h1"));

		expect(resolveTarget(text)?.address).toEqual({
			id: "hero-1",
			blockType: "hero",
		});
	});

	it("returns the block element itself, not the event target", () => {
		const hero = block("hero-1");
		const text = hero.child(new FakeElement("h1"));

		expect(resolveTarget(text)?.element).toBe(hero);
	});

	it("omits blockType when the block is not typed", () => {
		expect(resolveTarget(block("hero-1"))?.address).toEqual({ id: "hero-1" });
	});

	it("carries a field marked inside the block", () => {
		const hero = block("hero-1", "hero");
		const heading = hero.child(field("heading"));

		expect(resolveTarget(heading)?.address).toEqual({
			id: "hero-1",
			blockType: "hero",
			field: "heading",
		});
	});

	it("ignores a field marker belonging to an ancestor block", () => {
		/*
		 * A nested block sitting inside a marked field of its parent would
		 * otherwise report the parent's field name as its own.
		 */
		const section = block("sec-a", "section");
		const modules = section.child(field("modules"));
		const hero = modules.child(block("hero-1", "hero"));
		const text = hero.child(new FakeElement("h1"));

		expect(resolveTarget(text)?.address).toEqual({
			id: "hero-1",
			blockType: "hero",
		});
	});

	it("ignores an empty id", () => {
		expect(
			resolveTarget(new FakeElement("div", { [BLOCK_ID_ATTRIBUTE]: "" })),
		).toBeUndefined();
	});
});
