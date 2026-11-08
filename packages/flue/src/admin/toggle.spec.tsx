import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FlueState } from "./provider.js";
import type { ReactNode } from "react";

// The chat state the mocked provider reports.
let state: FlueState | null = null;

// The real module pulls in the whole admin bundle, including its styles.
vi.mock("@payloadcms/ui", () => ({
	Button: ({ children }: { children: ReactNode }) => (
		<button type="button">{children}</button>
	),
	SpinnerIcon: () => <svg />,
}));

vi.mock("./provider.js", () => ({ useFlue: () => state }));

const { FlueToggle } = await import("./toggle.js");

const flue = (overrides: Partial<FlueState>): FlueState => ({
	open: false,
	toggle: () => undefined,
	agents: [],
	runs: false,
	running: false,
	...overrides,
});

describe("the FlueToggle component", () => {
	it("renders nothing before sign-in", () => {
		state = null;

		expect(renderToStaticMarkup(<FlueToggle />)).toBe("");
	});

	it("renders nothing without an agent to chat with or runs to read", () => {
		state = flue({});

		expect(renderToStaticMarkup(<FlueToggle />)).toBe("");
	});

	it.each([
		["an agent to chat with", { agents: [{ slug: "editor" }] }],
		["only agent runs to read", { runs: true }],
	])("shows with %s", (_label, overrides) => {
		state = flue(overrides);

		expect(renderToStaticMarkup(<FlueToggle />)).toContain("Agents");
	});
});
