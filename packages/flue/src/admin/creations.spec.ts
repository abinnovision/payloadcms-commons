import { describe, expect, it } from "vitest";

import { createCreations } from "./creations.js";

describe("createCreations", () => {
	it("resolves the wait with the id the first message created", async () => {
		const creations = createCreations();
		const waited = creations.wait("local-1");

		creations.start("local-1").resolve(7);

		await expect(waited).resolves.toBe(7);
	});

	it("resolves a wait that starts after the message created the thread", async () => {
		const creations = createCreations();

		creations.start("local-1").resolve(7);

		await expect(creations.wait("local-1")).resolves.toBe(7);
	});

	it("rejects the wait when the first message fails", async () => {
		const creations = createCreations();
		const waited = creations.wait("local-1");

		creations.start("local-1").reject(new Error("refused"));

		await expect(waited).rejects.toThrow("refused");
	});

	it("starts afresh for the next message after a failure", async () => {
		const creations = createCreations();
		const first = creations.wait("local-1");

		creations.start("local-1").reject(new Error("refused"));
		await first.catch(() => undefined);

		const retried = creations.wait("local-1");

		creations.start("local-1").resolve(8);

		await expect(retried).resolves.toBe(8);
	});

	it("keeps the threads of different local ids apart", async () => {
		const creations = createCreations();
		const one = creations.wait("local-1");
		const two = creations.wait("local-2");

		creations.start("local-2").resolve(2);
		creations.start("local-1").resolve(1);

		await expect(Promise.all([one, two])).resolves.toEqual([1, 2]);
	});
});
