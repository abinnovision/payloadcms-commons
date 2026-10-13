import { describe, expect, it } from "vitest";

import * as entry from "./index.js";

describe('the "." entrypoint', () => {
	it("exports exactly the documented symbols", () => {
		expect(Object.keys(entry).sort()).toEqual([
			"createDummyConsoleReporter",
			"defineDummySeed",
			"dummyLocalized",
			"dummyPolyRef",
			"dummyRef",
			"isDummyWrite",
			"runDummySeeds",
		]);
	});
});
