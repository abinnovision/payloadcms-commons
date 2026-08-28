import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { defineMcpxTool } from "./types.js";

import type { McpxAnyTool } from "./types.js";

describe("defineMcpxTool", () => {
	it("infers the handler's arguments from a fixed input schema", () => {
		const tool = defineMcpxTool({
			name: "echo",
			description: "Echoes a message.",
			inputSchema: { message: z.string(), times: z.number().optional() },
			handler: ({ args }) => {
				expectTypeOf(args).toEqualTypeOf<{
					message: string;
					times?: number | undefined;
				}>();

				return { content: [{ type: "text", text: args.message }] };
			},
		});

		expect(tool.name).toBe("echo");
	});

	it("infers the handler's arguments from a shape built per request", () => {
		const tool = defineMcpxTool({
			name: "whichCollection",
			description: "Echoes back a collection this key may read.",
			inputSchema: (scope) => ({
				collection: z.enum(scope.readable as [string, ...string[]]),
				depth: z.number().optional(),
			}),
			handler: ({ args }) => {
				expectTypeOf(args).toEqualTypeOf<{
					collection: string;
					depth?: number | undefined;
				}>();

				return { content: [{ type: "text", text: args.collection }] };
			},
		});

		expect(tool.name).toBe("whichCollection");
	});

	it("holds tools of differing shapes in one registry", () => {
		/*
		 * The registry type every tool list uses: `options.tools`, the builtins
		 * and the registration loop. A tool with concrete arguments has to fit it
		 * or the unified route does not hold.
		 */
		const fixed = defineMcpxTool({
			name: "fixed",
			description: "A tool with a fixed shape.",
			inputSchema: { message: z.string() },
			handler: ({ args }) => ({
				content: [{ type: "text", text: args.message }],
			}),
		});

		/*
		 * A shape assembled from helpers that erase to `z.ZodRawShape` leaves
		 * nothing to infer from, so the argument type is stated instead.
		 */
		const dynamic = defineMcpxTool<{ collection: string }>({
			name: "dynamic",
			description: "A tool whose shape depends on the key.",
			isEnabled: (scope) => scope.readable.length > 0,
			inputSchema: (scope) => ({
				collection: z.enum(scope.readable as [string, ...string[]]),
			}),
			handler: ({ args }) => ({
				content: [{ type: "text", text: args.collection }],
			}),
		});

		const registry: McpxAnyTool[] = [fixed, dynamic];

		expect(registry.map((tool) => tool.name)).toEqual(["fixed", "dynamic"]);
	});
});
