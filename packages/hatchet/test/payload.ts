import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { buildConfig, getPayload, JobCancelledError } from "payload";
import { vi } from "vitest";

import { hatchetPlugin } from "../src/index.js";

import type { HatchetPluginOptions } from "../src/index.js";
import type { HatchetClient } from "@hatchet-dev/typescript-sdk";
import type { Config, Payload } from "payload";

/**
 * The only seam: records what would have been sent to Hatchet.
 */
export const createFakeHatchet = () => {
	const runNoWait = vi.fn(() =>
		Promise.resolve({
			runId: Promise.resolve(`run-${String(runNoWait.mock.calls.length)}`),
		}),
	);
	const create = vi.fn(() =>
		Promise.resolve({
			metadata: { id: `scheduled-${String(create.mock.calls.length)}` },
		}),
	);
	const deleteSchedule = vi.fn(() => Promise.resolve());
	const getStatus = vi.fn((_runId: string) => Promise.resolve("COMPLETED"));

	return {
		runNoWait,
		create,
		deleteSchedule,
		getStatus,
		client: {
			runNoWait,
			schedules: { create, delete: deleteSchedule },
			runs: { get_status: getStatus },
		} as unknown as HatchetClient,
	};
};

/**
 * Boots Payload on a file-backed SQLite database with real transactions. An
 * in-memory database would lose its schema to the second connection a
 * transaction opens.
 */
export const bootPayload = async (args: {
	key: string;
	hatchet: HatchetClient;
	config?: Partial<Config>;
	plugin?: HatchetPluginOptions;
}): Promise<Payload> => {
	const dir = mkdtempSync(join(tmpdir(), "payloadcms-hatchet-"));

	return await getPayload({
		key: args.key,
		config: buildConfig({
			secret: "hatchet-secret",
			db: sqliteAdapter({
				client: { url: `file:${join(dir, "payload.db")}` },
				transactionOptions: {},
			}),
			plugins: [hatchetPlugin({ client: () => args.hatchet, ...args.plugin })],
			...args.config,
			jobs: {
				tasks: [
					{ slug: "ok", handler: () => ({ output: {} }) },
					{
						slug: "fail",
						retries: 1,
						handler: () => {
							throw new Error("fail");
						},
					},
					{
						slug: "cancel",
						handler: () => {
							throw new JobCancelledError("cancel");
						},
					},
					{
						slug: "wait",
						handler: async ({ input }) => {
							await sleep((input as { ms: number }).ms, undefined, {
								ref: false,
							});

							return { output: {} };
						},
					},
					{
						// onFail throwing makes Payload's runner reject.
						slug: "crash",
						retries: 0,
						handler: () => {
							throw new Error("crash");
						},
						onFail: () => {
							throw new Error("onFail");
						},
					},
					{
						slug: "failFinal",
						retries: 0,
						handler: () => {
							throw new Error("failFinal");
						},
					},
				],
				...args.config?.jobs,
			},
		}),
	});
};
