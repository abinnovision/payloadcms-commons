import type { DummyRunResult, DummyWriteTally } from "./types.js";

export interface DummyWriteEvent {
	kind: "collection" | "global" | "upload";
	slug: string;
	/** The natural key, or the global's slug. */
	key: string;
	/** `"deferred"` means the write landed without its forward refs. */
	action: "created" | "deferred" | "skipped" | "updated";
}

/**
 * Everything a run makes visible.
 *
 * Every member is optional and none is supplied by default, so the library
 * writes nothing and a consumer can route a run into their own logger.
 */
export interface DummyReporter {
	runStarted?: (event: { seeds: readonly string[]; fresh: boolean }) => void;
	reset?: (event: { collections: readonly string[] }) => void;
	seedFinished?: (event: { id: string; durationMs: number }) => void;
	wrote?: (event: DummyWriteEvent) => void;
	warned?: (event: { message: string }) => void;
	runFinished?: (event: DummyRunResult) => void;
}

const pad = (value: number): string => String(value).padStart(3);

const summarise = (tally: DummyWriteTally): string =>
	`${pad(tally.created)} created, ${pad(tally.updated)} updated` +
	(tally.skipped > 0 ? `, ${pad(tally.skipped)} kept` : "") +
	(tally.deleted > 0 ? `, ${pad(tally.deleted)} deleted` : "");

/**
 * The reporter the CLI installs: a line per seed, then the per-collection tally
 * and the duration.
 *
 * Per-document events are aggregated rather than printed, because a seed writes
 * dozens and the tally is what an operator reads.
 *
 * @param options `quiet` keeps the tally and the warnings, dropping the rest.
 */
export const createDummyConsoleReporter = (
	options: { quiet?: boolean | undefined } = {},
): DummyReporter => {
	const quiet = options.quiet ?? false;
	const write = (line: string): void => {
		// eslint-disable-next-line no-console -- A seed CLI's interface is stdout.
		console.log(line);
	};

	return {
		runStarted: ({ seeds, fresh }) => {
			if (!quiet) {
				write(
					`\ndummy  mode: ${fresh ? "fresh" : "upsert"}  ` +
						`seeds: ${String(seeds.length)}\n`,
				);
			}
		},
		reset: ({ collections }) => {
			if (!quiet) {
				write(`dummy  cleared ${collections.join(", ")}`);
			}
		},
		seedFinished: ({ id, durationMs }) => {
			if (!quiet) {
				write(`dummy  ${id.padEnd(16)} ${(durationMs / 1000).toFixed(2)}s`);
			}
		},
		warned: ({ message }) => {
			write(`dummy  warning: ${message}`);
		},
		runFinished: ({ writes, durationMs, replayed }) => {
			write("");

			for (const [slug, tally] of writes) {
				write(`dummy  ${slug.padEnd(16)} ${summarise(tally)}`);
			}

			if (replayed > 0) {
				write(
					`dummy  ${"replayed".padEnd(16)} ${pad(replayed)} documents ` +
						"completed after their refs were written",
				);
			}

			write(`\ndummy  done in ${(durationMs / 1000).toFixed(1)}s\n`);
		},
	};
};
