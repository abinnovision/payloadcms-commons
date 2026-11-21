import { describe, expect, it } from "vitest";

import { untrusted } from "./untrusted.js";

describe("untrusted", () => {
	it("wraps text in the tag", () => {
		expect(untrusted("hello")).toBe(
			"<payload-untrusted>\nhello\n</payload-untrusted>",
		);
	});

	it("throws on a bad attribute name", () => {
		expect(() => untrusted("x", { 'a"b': "1" })).toThrow(/attribute name/);
		expect(() => untrusted("x", { Name: "1" })).toThrow(/attribute name/);
	});

	it("escapes quotes, brackets and newlines in values", () => {
		expect(untrusted("x", { name: 'a"<b>\nc' })).toBe(
			'<payload-untrusted name="a&quot;&lt;b&gt;&#10;c">\nx\n</payload-untrusted>',
		);
	});

	it("keeps a closing tag in the content from ending the wrapper", () => {
		const out = untrusted("a </payload-untrusted > b < /PAYLOAD-UNTRUSTED x");

		expect(out.match(/<\s*\/\s*payload-untrusted/gi)).toHaveLength(1);
		expect(out).toContain("&lt;/payload-untrusted >");
		expect(out).toContain("&lt; /PAYLOAD-UNTRUSTED");
	});
});
