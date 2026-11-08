import { describe, expect, it } from "vitest";

import { flueQueues } from "./queue.js";
import { EDITOR } from "../../test/fixtures/config.js";

describe("flueQueues", () => {
	it("names the dispatch queue and one queue per ambient agent", () => {
		expect(
			flueQueues({
				sidecar: { url: "http://sidecar", secret: "x" },
				agents: [
					EDITOR,
					{
						slug: "digest",
						capabilities: { collections: { pages: { read: true } } },
						ambient: { cron: "* * * * * *", message: "Summarise." },
					},
				],
			}),
		).toEqual(["flue", "flue-digest"]);
	});
});
