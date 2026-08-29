import { describe, expect, it } from "vitest";

import {
	hasPublishIntent,
	takePublishIntent,
	withPublishIntent,
} from "./publish-intent.js";

describe("publish intent", () => {
	it("is absent from an ordinary write", () => {
		expect(hasPublishIntent({ title: "Probe" })).toBe(false);
		expect(hasPublishIntent(undefined)).toBe(false);
		expect(hasPublishIntent(null)).toBe(false);
		expect(hasPublishIntent("published")).toBe(false);
	});

	it("marks one data object without touching what it carries", () => {
		const marked = withPublishIntent({ title: "Probe" });

		expect(hasPublishIntent(marked)).toBe(true);
		expect(marked.title).toBe("Probe");
	});

	it("cannot be forged by a client writing the key it uses", () => {
		const key = Object.keys(withPublishIntent({}))[0] as string;

		expect(hasPublishIntent({ [key]: true })).toBe(false);
		expect(hasPublishIntent({ [key]: "mcpx" })).toBe(false);
	});

	/*
	 * Payload copies the write data with `for (const k in value)`, which keeps
	 * enumerable string keys and drops symbols. `Object.entries` has the same
	 * reach over a plain object, so it stands in for that copy here.
	 */
	it("survives the copy Payload takes of the write data", () => {
		const marked = withPublishIntent({ title: "Probe" });
		const copy = Object.fromEntries(Object.entries(marked));

		expect(hasPublishIntent(copy)).toBe(true);
	});

	it("marks that object only, so a sibling write is unaffected", () => {
		const original = { title: "Probe" };

		expect(hasPublishIntent(withPublishIntent(original))).toBe(true);
		expect(hasPublishIntent(original)).toBe(false);
	});

	/*
	 * The guard rebuilds `data` on the way through, so the marker has to survive
	 * the spread and rest-destructuring `scrubWriteArgs` performs.
	 */
	it("survives being spread and rest-destructured", () => {
		const { _status: _ignored, ...rest } = withPublishIntent({
			_status: "draft",
			title: "Probe",
		});

		expect(hasPublishIntent({ ...rest, _status: "published" })).toBe(true);
	});

	it("is taken off once, so nothing downstream sees it", () => {
		const marked = withPublishIntent({ title: "Probe" });

		expect(takePublishIntent(marked)).toBe(true);
		expect(hasPublishIntent(marked)).toBe(false);
		expect(takePublishIntent(marked)).toBe(false);
		expect(marked).toStrictEqual({ title: "Probe" });
	});
});
