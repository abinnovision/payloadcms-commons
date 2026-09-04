import { isValidElement } from "react";
import { describe, expect, it } from "vitest";

import { BLOCK_ID_ATTRIBUTE, BLOCK_TYPE_ATTRIBUTE } from "../attributes.js";
import { Marked } from "./marked.js";

import type { ReactElement, ReactNode } from "react";

/**
 * `Marked` decides what to render without touching the DOM, so calling it and
 * reading the element back is the whole test. No renderer, no layout engine.
 */
const render = (node: ReactNode): ReactElement<Record<string, unknown>> => {
	expect(isValidElement(node)).toBe(true);

	return node as ReactElement<Record<string, unknown>>;
};

const Hero = (): ReactNode => null;

describe("marked", () => {
	it("marks a block's own element, adding nothing to the tree", () => {
		const result = render(
			Marked({
				blockType: "hero",
				children: <section className="hero" />,
				id: "block-1",
			}),
		);

		expect(result.type).toBe("section");
		expect(result.props[BLOCK_ID_ATTRIBUTE]).toBe("block-1");
		expect(result.props[BLOCK_TYPE_ATTRIBUTE]).toBe("hero");
		/* The element's own props survive the clone. */
		expect(result.props["className"]).toBe("hero");
	});

	it("leaves an element that already carries an id alone", () => {
		/*
		 * A block that spread `markBlock()` itself has said where its id goes,
		 * possibly on an inner element. Overwriting would move the address.
		 */
		const children = <section data-vf-id="chosen-by-the-block" />;
		const result = render(Marked({ children, id: "block-1" }));

		expect(result).toBe(children);
		expect(result.props[BLOCK_ID_ATTRIBUTE]).toBe("chosen-by-the-block");
	});

	it("wraps a component element, whose props may go nowhere", () => {
		const result = render(Marked({ children: <Hero />, id: "block-1" }));

		expect(result.type).toBe("div");
		expect(result.props["style"]).toEqual({ display: "contents" });
		expect(result.props[BLOCK_ID_ATTRIBUTE]).toBe("block-1");
	});

	it("wraps a fragment, which has no element to mark", () => {
		const result = render(Marked({ children: <>{"text"}</>, id: "block-1" }));

		expect(result.type).toBe("div");
	});

	it.each([
		["text", "just text"],
		["an array", [<Hero key="a" />, <Hero key="b" />]],
		["a promise", Promise.resolve(<Hero />) as unknown as ReactNode],
	])("wraps %s", (_label, children) => {
		expect(render(Marked({ children, id: "block-1" })).type).toBe("div");
	});

	it("renders children untouched when disabled or unsaved", () => {
		const children = <section className="hero" />;

		expect(Marked({ children, enabled: false, id: "block-1" })).toBe(children);
		expect(Marked({ children, id: "" })).toBe(children);
	});
});
