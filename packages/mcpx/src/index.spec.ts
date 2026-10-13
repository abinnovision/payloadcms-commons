import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as entry from "./index.js";
import * as local from "./local.js";

import type {
	McpxAnyTool,
	McpxAuthResult,
	McpxCollectionOptions,
	McpxDocumentId,
	McpxEntityCapabilities,
	McpxExposedEntity,
	McpxGlobalOptions,
	McpxPluginOptions,
	McpxRequestContext,
	McpxResolvedCapabilities,
	McpxScopeSlugs,
	McpxTool,
	McpxToolExtra,
	McpxToolScope,
} from "./index.js";
import type {
	McpxLocalCapabilities,
	McpxLocalEntityCapabilities,
} from "./local.js";

describe('the "." entrypoint', () => {
	it("exports exactly the documented runtime names", () => {
		expect(Object.keys(entry).sort()).toEqual([
			"defineMcpxTool",
			"errorResult",
			"isMcpxRequest",
			"jsonResult",
			"mcpxPlugin",
			"mcpxReadRequest",
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
		expectTypeOf<McpxCollectionOptions>().not.toBeAny();
		expectTypeOf<McpxEntityCapabilities>().not.toBeAny();
		expectTypeOf<McpxDocumentId>().toEqualTypeOf<number | string>();
		expectTypeOf<McpxExposedEntity>().not.toBeAny();
		expectTypeOf<McpxGlobalOptions>().not.toBeAny();
		expectTypeOf<McpxPluginOptions>().not.toBeAny();
		expectTypeOf<McpxRequestContext>().not.toBeAny();
		expectTypeOf<McpxResolvedCapabilities>().not.toBeAny();
		expectTypeOf<McpxScopeSlugs>().not.toBeAny();
		expectTypeOf<McpxTool>().not.toBeAny();
		expectTypeOf<McpxToolExtra>().not.toBeAny();
		expectTypeOf<McpxToolScope>().not.toBeAny();
	});
});

describe('the "./local" entrypoint', () => {
	it("exports exactly the documented runtime names", () => {
		expect(Object.keys(local).sort()).toEqual(["createMcpxClient"]);
	});

	it("keeps the documented type names exported", () => {
		expectTypeOf<McpxLocalCapabilities>().not.toBeAny();
		expectTypeOf<McpxLocalEntityCapabilities>().not.toBeAny();
	});
});

describe("package exports", () => {
	it("lists only the root, admin and local entrypoints", () => {
		const { exports } = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		) as { exports: Record<string, unknown> };

		expect(Object.keys(exports)).toEqual([".", "./admin", "./local"]);
	});
});
