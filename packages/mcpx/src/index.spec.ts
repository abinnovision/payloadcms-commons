import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as entry from "./index.js";

import type {
	McpxAnyTool,
	McpxAuthResult,
	McpxCollectionCapabilities,
	McpxCollectionOptions,
	McpxExposedEntity,
	McpxGlobalOptions,
	McpxPluginOptions,
	McpxRequestContext,
	McpxResolvedCapabilities,
	McpxTool,
	McpxToolExtra,
	McpxToolScope,
	McpxWriteMode,
	PublishBlocker,
} from "./index.js";

describe('the "." entrypoint', () => {
	it("exports exactly the documented runtime names", () => {
		expect(Object.keys(entry).sort()).toEqual([
			"defineMcpxTool",
			"errorResult",
			"isMcpxRequest",
			"jsonResult",
			"mcpxPlugin",
		]);
	});

	/*
	 * Types erase at runtime, so only the compiler can notice one going
	 * missing. Each is referenced so that removing or renaming it fails
	 * typecheck.
	 */
	it("keeps the documented type names exported", () => {
		expectTypeOf<McpxAnyTool>().not.toBeAny();
		expectTypeOf<McpxAuthResult>().not.toBeAny();
		expectTypeOf<McpxCollectionCapabilities>().not.toBeAny();
		expectTypeOf<McpxCollectionOptions>().not.toBeAny();
		expectTypeOf<McpxExposedEntity>().not.toBeAny();
		expectTypeOf<McpxGlobalOptions>().not.toBeAny();
		expectTypeOf<McpxPluginOptions>().not.toBeAny();
		expectTypeOf<McpxRequestContext>().not.toBeAny();
		expectTypeOf<McpxResolvedCapabilities>().not.toBeAny();
		expectTypeOf<McpxTool>().not.toBeAny();
		expectTypeOf<McpxToolExtra>().not.toBeAny();
		expectTypeOf<McpxToolScope>().not.toBeAny();
		expectTypeOf<McpxWriteMode>().toEqualTypeOf<"draft" | "live" | false>();
		expectTypeOf<PublishBlocker>().toHaveProperty("message");
	});
});

describe("package exports", () => {
	it("lists only the root and admin entrypoints", () => {
		const { exports } = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		) as { exports: Record<string, unknown> };

		expect(Object.keys(exports)).toEqual([".", "./admin"]);
	});
});
