import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { colorForName } from "../index.js";
import { TagPill } from "./tag-pill.js";

describe("tagPill", () => {
	it("renders the label and exposes the color as --tags-color", () => {
		const html = renderToStaticMarkup(<TagPill color="#3b82f6" label="News" />);

		expect(html).toContain('class="tags-pill"');
		expect(html).toContain("--tags-color:#3b82f6");
		expect(html).toContain(">News<");
	});

	it("falls back to the name-derived color for a missing or invalid color", () => {
		const missing = renderToStaticMarkup(<TagPill color={null} label="News" />);
		const invalid = renderToStaticMarkup(<TagPill color="blue" label="News" />);

		expect(missing).toContain(`--tags-color:${colorForName("News")}`);
		expect(invalid).toContain(`--tags-color:${colorForName("News")}`);
	});

	it("leaves the color to the stylesheet when muted", () => {
		const html = renderToStaticMarkup(<TagPill label="#42" muted />);

		expect(html).toContain('class="tags-pill tags-pill--muted"');
		expect(html).not.toContain("style=");
	});

	it("ships the stylesheet with text in --theme-text, not the tag color", () => {
		const html = renderToStaticMarkup(<TagPill color="#000" label="Dark" />);

		expect(html).toContain('data-precedence="default"');
		expect(html).toContain("color: var(--theme-text)");
	});
});
