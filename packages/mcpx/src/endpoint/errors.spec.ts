import { APIError, Forbidden, ValidationError } from "payload";
import { describe, expect, it, vi } from "vitest";

import { jsonRpcError, toToolError } from "./errors.js";

import type { Payload } from "payload";

const logger = { error: vi.fn() } as unknown as Payload["logger"];

const parse = (result: { content: { type: string; text?: string }[] }) =>
	JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>;

describe("jsonRpcError", () => {
	it("builds a JSON-RPC error response", async () => {
		const response = jsonRpcError({
			status: 401,
			code: -32001,
			message: "Unauthorized",
			headers: { "www-authenticate": "Bearer" },
		});

		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toBe("Bearer");
		expect(await response.json()).toEqual({
			jsonrpc: "2.0",
			id: null,
			error: { code: -32001, message: "Unauthorized" },
		});
	});
});

describe("toToolError", () => {
	it("passes validation detail through", () => {
		const error = new ValidationError({
			collection: "pages",
			errors: [{ path: "title", message: "Required", label: "Title" }],
		});

		expect(parse(toToolError(error, logger))).toMatchObject({
			status: 400,
			validationErrors: [{ path: "/title", message: "Required" }],
		});
	});

	it("keeps public Payload errors", () => {
		const result = toToolError(new Forbidden(), logger);

		expect(result.isError).toBe(true);
		expect(parse(result)).toMatchObject({ status: 403 });
	});

	it("hides internal errors and logs them", () => {
		expect(parse(toToolError(new Error("driver exploded"), logger))).toEqual({
			error: "Internal error",
		});
		expect(parse(toToolError(new APIError("secret", 500), logger))).toEqual({
			error: "Internal error",
		});
		expect(logger.error).toHaveBeenCalledTimes(2);
	});
});
