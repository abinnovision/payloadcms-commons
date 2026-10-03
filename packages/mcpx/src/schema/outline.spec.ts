import { beforeAll, describe, expect, it } from "vitest";

import { lexicalOutline } from "./outline.js";
import { node, state, text } from "../../test/builders/lexical.js";
import { buildFixtureConfig, fieldOf } from "../../test/fixtures/config.js";

import type { RichTextField } from "payload";

/**
 * Restricted to "h4" by its editor, so it pins the `options` narrowing.
 */
let summary: RichTextField;
/**
 * No feature narrows any of its node properties.
 */
let content: RichTextField;

beforeAll(async () => {
	const config = await buildFixtureConfig();

	summary = fieldOf(config, "posts", "summary") as RichTextField;
	content = fieldOf(config, "posts", "content") as RichTextField;
});

describe("lexicalOutline", () => {
	it("returns an absolute, patchable pointer for every node under root, depth-first", () => {
		const doc = state([
			node("paragraph", {}, [text("first")]),
			node("paragraph", {}, [
				text("second"),
				node("paragraph", {}, [text("nested")]),
			]),
		]);

		expect(
			lexicalOutline(doc, "/content", content).map((entry) => entry.pointer),
		).toEqual([
			"/content/root/children/0",
			"/content/root/children/0/children/0",
			"/content/root/children/1",
			"/content/root/children/1/children/0",
			"/content/root/children/1/children/1",
			"/content/root/children/1/children/1/children/0",
		]);
	});

	it("carries version so a sibling's can be copied onto an add", () => {
		const doc = state([node("paragraph", { version: 3 })]);

		expect(lexicalOutline(doc, "/content", content)[0]?.version).toBe(3);
	});

	it("omits version when the node does not carry a number", () => {
		const withoutVersion: Record<string, unknown> = node("paragraph");

		delete withoutVersion["version"];

		const doc = state([withoutVersion]);

		expect(lexicalOutline(doc, "/content", content)[0]).not.toHaveProperty(
			"version",
		);
	});

	it("concatenates every descendant text node", () => {
		const doc = state([
			node("paragraph", {}, [
				text("Hello, "),
				node("link", { fields: {} }, [text("world")]),
				text("!"),
			]),
		]);

		const entries = lexicalOutline(doc, "/content", content);

		expect(entries[0]?.text).toBe("Hello, world!");
		expect(entries.find((entry) => entry.type === "link")?.text).toBe("world");
	});

	it("truncates text past 80 characters and marks the cut", () => {
		const long = "x".repeat(90);
		const doc = state([node("paragraph", {}, [text(long)])]);

		expect(lexicalOutline(doc, "/content", content)[0]?.text).toBe(
			`${"x".repeat(80)}…`,
		);
	});

	it("omits text when the node has none", () => {
		const doc = state([node("paragraph")]);

		expect(lexicalOutline(doc, "/content", content)[0]).not.toHaveProperty(
			"text",
		);
	});

	it("reports children only as a count, and only when non-empty", () => {
		const doc = state([
			node("paragraph", {}, [text("has one child")]),
			node("paragraph"),
		]);

		const [withChild, withoutChildren] = lexicalOutline(
			doc,
			"/content",
			content,
		);

		expect(withChild?.children).toBe(1);
		expect(withoutChildren).not.toHaveProperty("children");
	});

	it("narrows options to what the field's editor actually restricts", () => {
		const doc = state([
			node("heading", { tag: "h4" }, [text("Title")]),
			node("paragraph", {}, [text("Body")]),
		]);

		const [heading, paragraph] = lexicalOutline(doc, "/summary", summary);

		expect(heading?.options).toEqual({ tag: "h4" });
		expect(paragraph).not.toHaveProperty("options");
	});

	it("omits options when the node lacks the narrowed property", () => {
		const withoutTag: Record<string, unknown> = node("heading", {}, [
			text("Title"),
		]);

		delete withoutTag["tag"];

		const doc = state([withoutTag]);

		expect(lexicalOutline(doc, "/summary", summary)[0]).not.toHaveProperty(
			"options",
		);
	});

	it("treats a prototype-named node type as an unknown type", () => {
		const doc = state([
			node("constructor", { tag: "h4" }),
			node("toString", { tag: "h4" }),
		]);

		const entries = lexicalOutline(doc, "/summary", summary);

		expect(entries.map((entry) => entry.type)).toEqual([
			"constructor",
			"toString",
		]);
		for (const entry of entries) {
			expect(entry).not.toHaveProperty("options");
		}
	});

	it("returns no entries for a state with no root children", () => {
		expect(lexicalOutline(undefined, "/content", content)).toEqual([]);
		expect(lexicalOutline({}, "/content", content)).toEqual([]);
		expect(lexicalOutline({ root: {} }, "/content", content)).toEqual([]);
		expect(lexicalOutline(state([]), "/content", content)).toEqual([]);
	});
});
