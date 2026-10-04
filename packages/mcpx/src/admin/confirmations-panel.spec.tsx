import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ConfirmationView } from "../api-keys/confirmation-view.js";

// What each rendered button would do when clicked, by its text.
const clicks = new Map<string, () => void>();

/*
 * The real module pulls in the whole admin bundle, including SCSS. The button
 * stands in for Payload's and records its handler, since a static render
 * cannot click.
 */
vi.mock("@payloadcms/ui", () => ({
	Button: ({
		children,
		onClick,
	}: {
		children: string | string[];
		onClick: () => void;
	}) => {
		const text = Array.isArray(children) ? children.join("") : children;

		clicks.set(text, onClick);

		return <button type="button">{text}</button>;
	},
}));

const { ConfirmationsPanel } = await import("./confirmations-panel.js");

const view = (
	handle: string,
	summary: Partial<ConfirmationView["summary"]> = {},
): ConfirmationView => ({
	handle,
	tool: "deleteDocument",
	group: "Delete documents",
	highlighted: false,
	summary: { label: "Page", id: handle, permanent: false, ...summary },
});

const render = (
	confirmations: ConfirmationView[],
	onDecide: (handles: string[], decision: string) => void = () => undefined,
) =>
	renderToStaticMarkup(
		<ConfirmationsPanel
			busy={false}
			confirmations={confirmations}
			onDecide={onDecide}
		/>,
	);

describe("the ConfirmationsPanel component", () => {
	it("renders nothing while no call is waiting", () => {
		expect(render([])).toBe("");
	});

	it("marks a permanent delete and counts it in the bulk approval", () => {
		const html = render([
			view("a", { title: "Home", status: "published" }),
			view("b", { permanent: true }),
		]);

		expect(html).toContain("published");
		expect(html).toContain("Moves to trash");
		expect(html).toContain("Permanent");
		expect(html).toContain("Approve all (2, 1 permanent)");
	});

	it("shows the reason as written by the client", () => {
		expect(render([view("a", { reason: "Duplicate." })])).toContain(
			"The client wrote: </span>Duplicate.",
		);
	});

	it("approves every listed call at once", () => {
		const decisions: [string[], string][] = [];

		render([view("a"), view("b")], (handles, decision) => {
			decisions.push([handles, decision]);
		});
		clicks.get("Approve all (2)")?.();

		expect(decisions).toEqual([[["a", "b"], "approved"]]);
	});
});
