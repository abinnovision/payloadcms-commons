import { afterEach, describe, expect, it, vi } from "vitest";

import { exitOnSignal } from "./exit-on-signal.js";
import { registerHatchetWorker } from "./index.js";
import { runHatchetWorker } from "../worker/index.js";

import type { RegisterHatchetWorkerOptions } from "./index.js";

vi.mock("./exit-on-signal.js", () => ({ exitOnSignal: vi.fn() }));
vi.mock("../worker/index.js", () => ({
	runHatchetWorker: vi.fn(() => Promise.resolve()),
}));

const options = {
	config: vi.fn<RegisterHatchetWorkerOptions["config"]>(),
	queues: ["default"],
};

describe("registerHatchetWorker", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
		delete (globalThis as { __payloadcmsHatchet?: unknown })
			.__payloadcmsHatchet;
	});

	it("does nothing outside the Node.js runtime", async () => {
		vi.stubEnv("NEXT_RUNTIME", "edge");
		vi.stubEnv("NEXT_MANUAL_SIG_HANDLE", "true");
		vi.stubEnv("HATCHET_CLIENT_TOKEN", "token");

		await registerHatchetWorker(options);

		expect(exitOnSignal).not.toHaveBeenCalled();
		expect(runHatchetWorker).not.toHaveBeenCalled();
	});

	it("installs only the exit handler when disabled", async () => {
		vi.stubEnv("NEXT_RUNTIME", "nodejs");
		vi.stubEnv("NEXT_MANUAL_SIG_HANDLE", "true");
		vi.stubEnv("HATCHET_CLIENT_TOKEN", "token");

		await registerHatchetWorker({ ...options, enabled: false });

		expect(exitOnSignal).toHaveBeenCalledOnce();
		expect(runHatchetWorker).not.toHaveBeenCalled();
	});

	it("starts one worker per process", async () => {
		vi.stubEnv("NEXT_RUNTIME", "nodejs");
		vi.stubEnv("NEXT_MANUAL_SIG_HANDLE", "true");
		vi.stubEnv("HATCHET_CLIENT_TOKEN", "token");

		await registerHatchetWorker(options);
		await registerHatchetWorker(options);

		expect(exitOnSignal).toHaveBeenCalledOnce();
		expect(runHatchetWorker).toHaveBeenCalledExactlyOnceWith(options);
	});

	it("skips the worker without a token", async () => {
		vi.stubEnv("NEXT_RUNTIME", "nodejs");
		vi.stubEnv("HATCHET_CLIENT_TOKEN", "");
		vi.spyOn(console, "warn").mockReturnValue();

		await registerHatchetWorker(options);

		expect(runHatchetWorker).not.toHaveBeenCalled();
	});
});
