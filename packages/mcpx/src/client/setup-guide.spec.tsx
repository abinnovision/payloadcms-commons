import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Fields = Record<string, { value: unknown } | undefined>;

interface MockState {
	id: number | string | undefined;
	serverURL: string;
	fields: Fields;
}

const state: MockState = {
	id: undefined,
	serverURL: "https://cms.example.com",
	fields: {
		apiKey: { value: "s3cret" },
		label: { value: "My Laptop" },
	},
};

// The real module pulls in the whole admin bundle, including SCSS. Only the
// four hooks the component touches matter here.
vi.mock("@payloadcms/ui", () => ({
	CopyToClipboard: ({ value }: { value: string }) => (
		<button data-copy={value} type="button" />
	),
	useConfig: () => ({
		config: { serverURL: state.serverURL, routes: { api: "/api" } },
	}),
	useDocumentInfo: () => ({ id: state.id }),
	useFormFields: (selector: (args: [typeof state.fields]) => unknown) =>
		selector([state.fields]),
}));

const { McpxSetupGuide } = await import("./setup-guide.js");

const render = () =>
	renderToStaticMarkup(<McpxSetupGuide endpointPath="/mcpx" />);

describe("mcpxSetupGuide", () => {
	beforeEach(() => {
		state.id = 1;
		state.serverURL = "https://cms.example.com";
		state.fields = {
			apiKey: { value: "s3cret" },
			label: { value: "My Laptop" },
		};
	});

	// The whole point of the guide is handing over a key, and on create there is
	// no key yet: the field must stay out of the initial setup form entirely.
	it("renders nothing before the document is saved", () => {
		state.id = undefined;

		expect(render()).toBe("");
	});

	it("renders the snippets once the document has an id", () => {
		const html = render();

		expect(html).toContain("https://cms.example.com/api/mcpx");
		expect(html).toContain("Authorization: Bearer s3cret");
		expect(html).toContain("my-laptop");
	});

	it("offers a copy button per section", () => {
		expect(render().match(/data-copy=/g)).toHaveLength(4);
	});

	// Server render has no `window`; the origin fallback must wait for mount
	// rather than throw or emit a mismatched URL.
	it("survives a server render without serverURL", () => {
		state.serverURL = "";

		expect(() => render()).not.toThrow();
		expect(render()).toContain("/api/mcpx");
	});
});
