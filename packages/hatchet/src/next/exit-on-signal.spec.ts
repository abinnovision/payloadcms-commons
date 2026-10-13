import { EventEmitter } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import { exitOnSignal } from "./exit-on-signal.js";

const createHost = () => Object.assign(new EventEmitter(), { exit: vi.fn() });

describe("exitOnSignal", () => {
	it("exits right away without a pending worker", async () => {
		const host = createHost();
		exitOnSignal(() => undefined, 60_000, host);

		host.emit("SIGTERM");
		await sleep(0);

		expect(host.exit).toHaveBeenCalledWith(143);
	});

	it("waits for the worker and ignores a second signal", async () => {
		const host = createHost();
		const { promise, resolve } = Promise.withResolvers<undefined>();
		exitOnSignal(() => promise, 60_000, host);

		host.emit("SIGINT");
		host.emit("SIGINT");
		await sleep(0);
		expect(host.exit).not.toHaveBeenCalled();

		resolve(undefined);
		await sleep(0);
		expect(host.exit).toHaveBeenCalledExactlyOnceWith(130);
	});

	it("exits after the timeout", async () => {
		const host = createHost();
		const { promise } = Promise.withResolvers<undefined>();
		exitOnSignal(() => promise, 5, host);

		host.emit("SIGTERM");
		await sleep(20);

		expect(host.exit).toHaveBeenCalledWith(143);
	});
});
