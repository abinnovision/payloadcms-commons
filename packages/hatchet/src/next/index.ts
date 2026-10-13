import type { RunHatchetWorkerOptions } from "../worker/index.js";
import type { InitOptions } from "payload";

export interface RegisterHatchetWorkerOptions extends Omit<
	RunHatchetWorkerOptions,
	"config"
> {
	/**
	 * Loads the Payload config, e.g. `() => import("@payload-config")`.
	 */
	config: Exclude<RunHatchetWorkerOptions["config"], InitOptions["config"]>;

	/**
	 * Whether to start the worker. Defaults to `true`.
	 */
	enabled?: boolean | undefined;
}

interface State {
	worker?: Promise<void>;
	exitOnSignal?: true;
}

/**
 * Runs the Hatchet worker inside the Next.js server. Call it from `register`
 * in `instrumentation.ts`. Under `NEXT_MANUAL_SIG_HANDLE` it also exits the
 * process on SIGTERM and SIGINT once the running jobs finished.
 */
export const registerHatchetWorker = async (
	options: RegisterHatchetWorkerOptions,
): Promise<void> => {
	if (process.env["NEXT_RUNTIME"] !== "nodejs") {
		return;
	}

	// The global survives dev reloads, so each step happens once per process.
	const store = globalThis as { __payloadcmsHatchet?: State };
	const state = (store.__payloadcmsHatchet ??= {});
	const { enabled = true, ...workerOptions } = options;

	/*
	 * Installed with or without the worker, since Next.js then no longer exits
	 * on its own. Imported dynamically, like the worker: the edge bundle has no
	 * `process.on`, Payload or Hatchet.
	 */
	if (process.env["NEXT_MANUAL_SIG_HANDLE"] && !state.exitOnSignal) {
		state.exitOnSignal = true;

		const { exitOnSignal } = await import("./exit-on-signal.js");

		exitOnSignal(() => state.worker, options.shutdownTimeoutMs ?? 30_000);
	}

	if (!enabled || state.worker) {
		return;
	}

	if (!options.hatchet && !process.env["HATCHET_CLIENT_TOKEN"]) {
		// eslint-disable-next-line no-console -- Payload has not booted yet.
		console.warn("Hatchet worker not started: HATCHET_CLIENT_TOKEN is unset");

		return;
	}

	const { runHatchetWorker } = await import("../worker/index.js");

	// Not awaited: Next.js waits for `register`, the worker runs until a stop.
	state.worker ??= runHatchetWorker(workerOptions).catch((error: unknown) => {
		// eslint-disable-next-line no-console -- Payload may not have booted.
		console.error("Hatchet worker failed", error);
	});
};
