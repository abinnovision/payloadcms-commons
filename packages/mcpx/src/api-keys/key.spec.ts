import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { generateApiKey, hashApiKey } from "./key.js";

describe("generateApiKey", () => {
	it("produces distinct url-safe keys", () => {
		const key = generateApiKey();

		expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(generateApiKey()).not.toBe(key);
	});
});

describe("hashApiKey", () => {
	it("matches the HMAC payload core uses for apiKeyIndex", () => {
		const expected = crypto
			.createHmac("sha256", "secret")
			.update("key")
			.digest("hex");

		expect(hashApiKey("secret", "key")).toBe(expected);
	});
});
