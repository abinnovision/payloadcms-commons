import { registerHatchetWorker } from "@abinnovision/payloadcms-hatchet/next";

/*
 * Runs the Hatchet worker inside the Next.js server when
 * `HATCHET_IN_PROCESS_WORKER=true`, so `yarn dev` alone executes the jobs.
 * Use it or `yarn worker`, not both: SQLite allows a single writer.
 */
export const register = async (): Promise<void> => {
	// Keeps the config import out of the edge bundle.
	if (process.env.NEXT_RUNTIME === "nodejs") {
		await registerHatchetWorker({
			config: () => import("@payload-config"),
			queues: ["default"],
			slots: 1,
			enabled: process.env.HATCHET_IN_PROCESS_WORKER === "true",
		});
	}
};
