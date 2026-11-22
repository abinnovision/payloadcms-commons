import { describe, expect, it } from "vitest";

import { strategyAuthOf, withMcpxAuth } from "./strategy.js";

const auth = {
	principal: "test:1",
	capabilities: { collections: { tags: { read: true } } },
};

describe("withMcpxAuth", () => {
	it("attaches auth that strategyAuthOf reads back", () => {
		const user = withMcpxAuth({ id: 1, collection: "users" }, auth);

		expect(strategyAuthOf(user)).toEqual(auth);
		expect(user).toMatchObject({ id: 1, collection: "users" });
	});

	it("leaves the given user unchanged", () => {
		const user = { id: 1, collection: "users" };

		withMcpxAuth(user, auth);

		expect(strategyAuthOf(user)).toBeUndefined();
	});

	it("keeps the auth through a spread and drops it from JSON", () => {
		const user = withMcpxAuth({ id: 1, collection: "users" }, auth);

		expect(strategyAuthOf({ ...user })).toEqual(auth);
		expect(strategyAuthOf(JSON.parse(JSON.stringify(user)))).toBeUndefined();
	});
});

describe("strategyAuthOf", () => {
	it("is undefined for a user without attached auth", () => {
		expect(strategyAuthOf({ id: 1, collection: "users" })).toBeUndefined();
		expect(strategyAuthOf(null)).toBeUndefined();
		expect(strategyAuthOf(undefined)).toBeUndefined();
	});

	it("ignores a string key of the same name", () => {
		expect(
			strategyAuthOf({ "@abinnovision/payloadcms-mcpx/auth": auth }),
		).toBeUndefined();
	});
});
