import process from "node:process";
import { parseArgs } from "node:util";

import { createDummyConsoleReporter } from "../reporter.js";
import { runDummySeeds } from "../run.js";

import type { DummyRunOptions } from "../types.js";
import type { Payload } from "payload";

export interface DummyCliOptions extends Omit<
	DummyRunOptions,
	"fresh" | "only" | "payload" | "reporter"
> {
	/**
	 * A thunk rather than an instance, so `--help` does not connect to a
	 * database.
	 */
	payload: () => Promise<Payload>;
	/** Default `process.argv.slice(2)`. */
	argv?: readonly string[] | undefined;
	/** Default {@link createDummyConsoleReporter}. */
	reporter?: DummyRunOptions["reporter"];
}

const USAGE = `Usage: payload run <seed script> [options]

  --fresh            Delete the reset collections before seeding.
  --only <id>        Run only this seed. Repeatable.
  --quiet            Print the tally and warnings only.
  --help             Print this and exit.`;

/**
 * Runs a seed script end to end: parses the flags, boots Payload, seeds,
 * prints the outcome, sets the exit code and destroys Payload.
 *
 * Never rejects, so a consumer's top-level `await` needs no `try`. Sets
 * `process.exitCode` rather than calling `process.exit`, because `process.exit`
 * can truncate pending stdout and a destroyed Payload holds the loop open no
 * longer.
 *
 * @param options The seeds, the Payload thunk and the run's settings.
 * @returns The exit code, so a test can run this in process.
 */
export const runDummyCli = async (
	options: DummyCliOptions,
): Promise<number> => {
	const write = (line: string): void => {
		// eslint-disable-next-line no-console -- A seed CLI's interface is stdout.
		console.log(line);
	};

	let flags: {
		fresh?: boolean | undefined;
		only?: string[] | undefined;
		quiet?: boolean | undefined;
		help?: boolean | undefined;
	};

	try {
		({ values: flags } = parseArgs({
			args: [...(options.argv ?? process.argv.slice(2))],
			options: {
				fresh: { type: "boolean", default: false },
				only: { type: "string", multiple: true },
				quiet: { type: "boolean", default: false },
				help: { type: "boolean", default: false },
			},
		}));
	} catch (error) {
		write(
			`[payloadcms-dummy] ${error instanceof Error ? error.message : String(error)}`,
		);
		write(USAGE);
		process.exitCode = 1;

		return 1;
	}

	if (flags.help === true) {
		write(USAGE);
		write(`\nSeeds: ${options.seeds.map((seed) => seed.id).join(", ")}`);

		return 0;
	}

	const payload = await options.payload();

	try {
		await runDummySeeds({
			...options,
			payload,
			fresh: flags.fresh ?? false,
			...(flags.only === undefined ? {} : { only: flags.only }),
			reporter:
				options.reporter ??
				createDummyConsoleReporter({ quiet: flags.quiet ?? false }),
		});

		return 0;
	} catch (error) {
		const raw = error instanceof Error ? error.message : String(error);
		// `fail` already prefixes its messages, and this line adds its own.
		const message = raw.replace(/^\[payloadcms-dummy\] /, "");

		write(`\n[payloadcms-dummy] failed: ${message}`);

		let cause: unknown = error instanceof Error ? error.cause : undefined;

		while (cause instanceof Error) {
			write(`[payloadcms-dummy]   caused by: ${cause.message}`);
			cause = cause.cause;
		}

		if (/ECONNREFUSED|ETIMEDOUT|ServerSelection|ENOENT/i.test(String(error))) {
			write("[payloadcms-dummy]   is the database reachable?");
		}

		process.exitCode = 1;

		return 1;
	} finally {
		await payload.destroy();
	}
};
