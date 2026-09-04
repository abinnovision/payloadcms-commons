import { describe, expect, it } from "vitest";

import { createBlockContext } from "../context.js";
import { lexicalConverters } from "./index.js";

import type { Renderer } from "../types.js";

interface MyContext {
	locale: string;
}

const fakeRenderer = (registered: Set<string>): Renderer<MyContext> => ({
	Block: ({ block }) =>
		`rendered:${(block as { blockType: string }).blockType}`,
	renderBlockTree: () => Promise.resolve(null),
	canRender: () => true,
	isRegistered: (slug) => registered.has(slug),
	resolveBlockData: () => Promise.resolve(undefined),
	getBlockData: () => undefined,
});

describe("lexicalConverters", () => {
	it("returns a converter for a registered block slug", () => {
		const renderer = fakeRenderer(new Set(["hero-module"]));
		const ctx = createBlockContext<MyContext>({ locale: "de" });
		const converters = lexicalConverters(renderer, ctx);

		const blocks = converters["blocks"] as Record<string, unknown>;
		expect(typeof blocks["hero-module"]).toBe("function");
	});

	it("returns undefined for an unregistered block slug", () => {
		const renderer = fakeRenderer(new Set());
		const ctx = createBlockContext<MyContext>({ locale: "de" });
		const converters = lexicalConverters(renderer, ctx);

		const blocks = converters["blocks"] as Record<string, unknown>;
		expect(blocks["hero-module"]).toBeUndefined();
	});

	it("renders node.fields through renderer.Block, the same object reference the resolver sees", () => {
		const renderer = fakeRenderer(new Set(["hero-module"]));
		const ctx = createBlockContext<MyContext>({ locale: "de" });
		const converters = lexicalConverters(renderer, ctx);

		const blocks = converters["blocks"] as Record<
			string,
			(args: { node: { fields: unknown } }) => unknown
		>;
		const converter = blocks["hero-module"];
		expect(converter).toBeDefined();

		const fields = { blockType: "hero-module", id: "1" };
		const el = converter?.({ node: { fields } }) as {
			props: { block: unknown };
		};
		expect(el.props.block).toBe(fields);
	});
});
