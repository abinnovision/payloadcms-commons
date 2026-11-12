// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import {
	coalesced,
	documentRegistry,
	documentUrl,
	fieldPathOf,
	prepareTurn,
	STALE_MESSAGE,
} from "./document.js";

import type { OpenDocument } from "./document.js";

const openDocument = (
	state: { modified: boolean; drafts: boolean; stale?: boolean },
	saved: string[],
): OpenDocument => ({
	collection: "pages",
	id: "12",
	drafts: state.drafts,
	modified: () => state.modified,
	stale: () => state.stale === true,
	focus: () => undefined,
	saveDraft: () => {
		saved.push("pages/12");

		return Promise.resolve();
	},
	reload: () => undefined,
});

describe("documentUrl", () => {
	it("addresses a collection document's draft in the locale", () => {
		expect(
			documentUrl({
				serverURL: "https://cms.example/",
				apiRoute: "/api",
				collection: "pages",
				id: "12",
				locale: "de",
			}),
		).toBe(
			"https://cms.example/api/pages/12?depth=0&draft=true&fallback-locale=null&locale=de",
		);
	});

	it("addresses a global without a locale", () => {
		expect(
			documentUrl({ serverURL: "", apiRoute: "/api", global: "settings" }),
		).toBe("/api/globals/settings?depth=0&draft=true&fallback-locale=null");
	});
});

describe("fieldPathOf", () => {
	const inside = (id: string): Element => {
		const field = document.createElement("div");
		const input = document.createElement("input");

		field.id = id;
		field.append(input);

		return input;
	};

	it("reads a nested path from the field's id", () => {
		expect(fieldPathOf(inside("field-blocks__0__title"))).toBe(
			"blocks.0.title",
		);
	});

	it("leaves out what follows a dash", () => {
		expect(fieldPathOf(inside("field-status-published"))).toBe("status");
	});

	it("answers undefined outside a field", () => {
		expect(fieldPathOf(inside("composer"))).toBeUndefined();
		expect(fieldPathOf(null)).toBeUndefined();
	});
});

describe("prepareTurn", () => {
	it("saves unsaved edits as a draft", async () => {
		const saved: string[] = [];

		await prepareTurn(openDocument({ modified: true, drafts: true }, saved));

		expect(saved).toEqual(["pages/12"]);
	});

	it("refuses unsaved edits without drafts and saves nothing", async () => {
		const saved: string[] = [];

		await expect(
			prepareTurn(openDocument({ modified: true, drafts: false }, saved)),
		).rejects.toThrow("Save the document before asking the agent.");
		expect(saved).toEqual([]);
	});

	it("refuses a stale form and saves nothing", async () => {
		const saved: string[] = [];

		await expect(
			prepareTurn(
				openDocument({ modified: true, drafts: true, stale: true }, saved),
			),
		).rejects.toThrow(STALE_MESSAGE);
		expect(saved).toEqual([]);
	});

	it("saves nothing without unsaved edits or an open document", async () => {
		const saved: string[] = [];

		await prepareTurn(openDocument({ modified: false, drafts: false }, saved));
		await prepareTurn(undefined);

		expect(saved).toEqual([]);
	});
});

describe("coalesced", () => {
	it("folds calls during a run into one more run", async () => {
		const runs: (() => void)[] = [];
		const trigger = coalesced(
			() =>
				new Promise<void>((resolve) => {
					runs.push(resolve);
				}),
			() => undefined,
		);

		trigger();
		trigger();
		trigger();

		expect(runs).toHaveLength(1);

		runs[0]!();
		await vi.waitFor(() => {
			expect(runs).toHaveLength(2);
		});

		runs[1]!();
		await new Promise((resolve) => {
			setTimeout(resolve, 10);
		});

		expect(runs).toHaveLength(2);
	});

	it("reports a failed run and runs again on the next call", async () => {
		const errors: unknown[] = [];
		let calls = 0;
		const trigger = coalesced(
			() => {
				calls += 1;

				return Promise.reject(new Error("Offline"));
			},
			(error) => errors.push(error),
		);

		trigger();
		await vi.waitFor(() => {
			expect(errors).toHaveLength(1);
		});
		trigger();
		await vi.waitFor(() => {
			expect(calls).toBe(2);
		});
	});
});

describe("documentRegistry", () => {
	it("tells subscribers when a document registers", () => {
		const registry = documentRegistry();
		let calls = 0;
		const unsubscribe = registry.subscribe(() => {
			calls += 1;
		});

		registry.register(openDocument({ modified: false, drafts: true }, []));
		unsubscribe();
		registry.register(openDocument({ modified: false, drafts: true }, []));

		expect(calls).toBe(1);
	});

	it("keeps a newer document when an older one unregisters", () => {
		const registry = documentRegistry();
		const first = openDocument({ modified: false, drafts: true }, []);
		const second = openDocument({ modified: false, drafts: true }, []);
		const unregisterFirst = registry.register(first);
		const unregisterSecond = registry.register(second);

		unregisterFirst();

		expect(registry.current()).toBe(second);

		unregisterSecond();

		expect(registry.current()).toBeUndefined();
	});
});
