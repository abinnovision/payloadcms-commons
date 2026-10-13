import { setTimeout } from "node:timers/promises";

interface Host {
	on: (signal: NodeJS.Signals, listener: () => void) => unknown;
	exit: (code: number) => unknown;
}

/**
 * Exits on SIGTERM and SIGINT once `pending()` settles, after `timeoutMs` at
 * most. For `NEXT_MANUAL_SIG_HANDLE`, under which Next.js installs no handler
 * and the app has to exit itself.
 */
export const exitOnSignal = (
	pending: () => Promise<void> | undefined,
	timeoutMs: number,
	host: Host = process,
): void => {
	let exiting = false;
	const exit = (code: number) => () => {
		// Ctrl-C reaches `next dev`'s server twice: from the shell and the CLI.
		if (exiting) {
			return;
		}

		exiting = true;
		void Promise.race([pending(), setTimeout(timeoutMs)]).then(() =>
			host.exit(code),
		);
	};

	host.on("SIGTERM", exit(143));
	host.on("SIGINT", exit(130));
};
