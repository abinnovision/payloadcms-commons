// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ToolsContext } from "./tools.js";

import type { FlueApi } from "./api.js";
import type { ReactNode } from "react";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@payloadcms/ui", () => ({
	PayloadLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

const { WorkspaceFile } = await import("./file-card.js");

// Renders the card with a files API that answers `link`, and waits for the lookup.
const show = async (link: () => Promise<null | string>) => {
	const fileLink = vi.fn(link);
	const container = document.createElement("div");
	const root = createRoot(container);

	await act(async () => {
		root.render(
			<ToolsContext
				value={{
					api: { fileLink } as unknown as FlueApi,
					filesSlug: "flue-files",
					adminRoute: "/admin",
					origin: "https://cms.example.com",
				}}
			>
				<WorkspaceFile id="12" name="brief.pdf" />
			</ToolsContext>,
		);
		await Promise.resolve();
	});

	return { container, fileLink };
};

describe("workspaceFile", () => {
	it("links the name to the file route", async () => {
		const { container, fileLink } = await show(() =>
			Promise.resolve("/api/flue-files/file/abc.pdf"),
		);
		const anchor = container.querySelector("a")!;

		expect(fileLink).toHaveBeenCalledWith("flue-files", "12");
		expect(anchor.getAttribute("href")).toBe("/api/flue-files/file/abc.pdf");
		expect(anchor.textContent).toBe("brief.pdf");
	});

	it("shows a removed file struck through and without a link", async () => {
		const { container } = await show(() => Promise.resolve(null));

		expect(container.querySelector("a")).toBeNull();
		expect(
			container.querySelector(".flue-attachment--removed")?.textContent,
		).toBe("brief.pdf (removed)");
	});

	it("shows only the name when the lookup fails", async () => {
		const { container } = await show(() => Promise.reject(new Error("down")));

		expect(container.querySelector("a")).toBeNull();
		expect(container.querySelector(".flue-attachment")?.textContent).toBe(
			"brief.pdf",
		);
		expect(container.querySelector(".flue-attachment--removed")).toBeNull();
	});
});
