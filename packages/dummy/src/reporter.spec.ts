import { describe, expect, it, vi } from "vitest";

import { createDummyConsoleReporter } from "./reporter.js";

import type { DummyRunResult } from "./types.js";

/* The reporter's output is what an operator sees, so the lines are the outcome. */
const captured = (
	use: (reporter: ReturnType<typeof createDummyConsoleReporter>) => void,
	options?: { quiet?: boolean },
): string[] => {
	const lines: string[] = [];
	const spy = vi
		.spyOn(console, "log")
		.mockImplementation((line: unknown) => lines.push(String(line)));

	try {
		use(createDummyConsoleReporter(options));
	} finally {
		spy.mockRestore();
	}

	return lines;
};

const result = (over: Partial<DummyRunResult> = {}): DummyRunResult => ({
	durationMs: 1500,
	seeds: ["pages"],
	writes: new Map([
		["pages", { created: 2, updated: 1, skipped: 0, deleted: 0 }],
	]),
	replayed: 0,
	...over,
});

describe("createDummyConsoleReporter", () => {
	it("says whether the run is fresh or an upsert", () => {
		const lines = captured((it) =>
			it.runStarted?.({ seeds: ["a", "b"], fresh: true }),
		);

		expect(lines.join("\n")).toMatch(/mode: fresh {2}seeds: 2/);
	});

	it("reports the per-collection tally and the duration", () => {
		const lines = captured((it) => it.runFinished?.(result()));

		expect(lines.join("\n")).toMatch(/pages\s+2 created,\s+1 updated/);
		expect(lines.join("\n")).toMatch(/done in 1\.5s/);
	});

	it("counts kept documents when a global was left alone", () => {
		const lines = captured((it) =>
			it.runFinished?.(
				result({
					writes: new Map([
						["banner", { created: 0, updated: 0, skipped: 1, deleted: 0 }],
					]),
				}),
			),
		);

		expect(lines.join("\n")).toMatch(/1 kept/);
	});

	it("reports the replay only when something was deferred", () => {
		expect(captured((it) => it.runFinished?.(result())).join("\n")).not.toMatch(
			/replayed/,
		);
		expect(
			captured((it) => it.runFinished?.(result({ replayed: 2 }))).join("\n"),
		).toMatch(/replayed\s+2 documents/);
	});

	it("prints a warning even when quiet", () => {
		const lines = captured(
			(it) => it.warned?.({ message: "filenames are rewritten" }),
			{ quiet: true },
		);

		expect(lines.join("\n")).toContain("warning: filenames are rewritten");
	});

	it("drops the per-seed lines when quiet", () => {
		expect(
			captured((it) => it.seedFinished?.({ id: "pages", durationMs: 10 }), {
				quiet: true,
			}),
		).toEqual([]);
	});
});
