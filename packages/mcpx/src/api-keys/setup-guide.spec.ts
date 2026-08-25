import { describe, expect, it } from "vitest";

import {
	buildSetupGuide,
	KEY_PLACEHOLDER,
	toServerName,
} from "./setup-guide.js";

const snippets = (sections: { id: string; snippet: string }[]) =>
	Object.fromEntries(sections.map((s) => [s.id, s.snippet]));

describe("toServerName", () => {
	it("slugifies the label and falls back to a default", () => {
		expect(toServerName("Claude Code")).toBe("claude-code");
		expect(toServerName("  --Weird!! label--  ")).toBe("weird-label");
		expect(toServerName("")).toBe("payload");
		expect(toServerName(null)).toBe("payload");
		expect(toServerName(undefined)).toBe("payload");
	});
});

describe("buildSetupGuide", () => {
	it("fills the URL and the key into every section", () => {
		expect(
			buildSetupGuide({
				endpointUrl: "https://cms.example.com/api/mcpx",
				apiKey: "s3cret",
				label: "Claude Code",
			}),
		).toMatchSnapshot();
	});

	it("gives every section a distinct id and a copyable snippet", () => {
		const sections = buildSetupGuide({
			endpointUrl: "https://x.test/api/mcpx",
			apiKey: "k",
		});
		const ids = sections.map((section) => section.id);

		expect(new Set(ids).size).toBe(ids.length);
		expect(sections.every((section) => section.snippet.length > 0)).toBe(true);
	});

	it("falls back to a placeholder when the key is unavailable", () => {
		const byId = snippets(
			buildSetupGuide({ endpointUrl: "https://x.test/api/mcpx" }),
		);

		expect(byId["header"]).toBe(`Authorization: Bearer ${KEY_PLACEHOLDER}`);
		expect(Object.values(byId).join("\n")).not.toContain("undefined");
	});
});
