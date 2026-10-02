import { describe, expect, it } from "vitest";

import { resolveSelection } from "./selection.js";

import type { TagOption } from "./selection.js";

describe("resolveSelection", () => {
	it("reuses an existing option by id", () => {
		const result = resolveSelection({ id: "1", label: "News" }, []);

		expect(result).toEqual({ type: "reuse", id: "1" });
	});

	it("creates a new tag when react-select flags it __isNew__ and nothing matches", () => {
		const result = resolveSelection({ __isNew__: true, label: "New" }, [
			{ id: "1", label: "News" },
		]);

		expect(result).toEqual({ type: "create", label: "New" });
	});

	it("reuses an existing tag case-insensitively even when flagged __isNew__", () => {
		const result = resolveSelection({ __isNew__: true, label: "NEWS" }, [
			{ id: "1", label: "News" },
		]);

		expect(result).toEqual({ type: "reuse", id: "1" });
	});

	it("trims the typed label before comparing and before creating", () => {
		const reused = resolveSelection({ __isNew__: true, label: "  news  " }, [
			{ id: "1", label: "News" },
		]);
		const created = resolveSelection({ __isNew__: true, label: "  New  " }, []);

		expect(reused).toEqual({ type: "reuse", id: "1" });
		expect(created).toEqual({ type: "create", label: "New" });
	});

	it("resolves to empty for a blank or whitespace-only label", () => {
		expect(resolveSelection({ __isNew__: true, label: "" }, [])).toEqual({
			type: "empty",
		});
		expect(resolveSelection({ __isNew__: true, label: "   " }, [])).toEqual({
			type: "empty",
		});
	});

	it("reuses the oldest tag when several case-insensitive duplicates exist", () => {
		const existing: TagOption[] = [
			{ id: "2", label: "news", createdAt: "2024-02-01T00:00:00.000Z" },
			{ id: "1", label: "News", createdAt: "2024-01-01T00:00:00.000Z" },
			{ id: "3", label: "NEWS", createdAt: "2024-03-01T00:00:00.000Z" },
		];

		const result = resolveSelection(
			{ __isNew__: true, label: "news" },
			existing,
		);

		expect(result).toEqual({ type: "reuse", id: "1" });
	});
});
