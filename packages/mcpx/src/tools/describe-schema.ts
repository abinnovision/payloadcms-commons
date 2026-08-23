import { z } from "zod";

import { collectionEnum, ensureAllowed } from "./shared.js";
import { jsonResult } from "../endpoint/result.js";
import {
	describeNode,
	REACHABLE_PATHS_LIMIT,
	reachableSchemaPaths,
} from "../schema/describe.js";

import type { BuiltinTool } from "./types.js";

const DESCRIPTION = `Describes the writable shape of a document, one node at a time.

Call it with no "paths" to get a collection's own fields. Every "blocks" field stops there and lists the block slugs it accepts instead of nesting them; each node's "next" lists the ready-to-use paths for those blocks, so pass any entry of "next" as a "paths" element to descend, e.g. "layout.sections.sectionWrapper" and then "layout.sections.sectionWrapper.modules.hero". A block is described as it exists at that position, because the same block can accept different children elsewhere.

Field paths are dotted and already resolved through anything that does not nest in the stored document. To turn one into a patchDocument pointer, replace each "." with "/", add a leading "/", and replace each "[]" with a 0-based index. Note a path here names a block by its slug where a pointer names it by its index.

Fields Payload maintains (id, _status, createdAt, updatedAt) are never listed and cannot be written. Fields marked readOnly are listed but refused on write.`;

interface Args {
	collection: string;
	expand?: boolean;
	paths?: string[];
}

const describeSchema: BuiltinTool<Args> = {
	name: "describeSchema",
	description: DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: (scope) => scope.readable.length > 0,
	inputSchema: (scope) => ({
		collection: collectionEnum(scope.readable).describe(
			"Collection to describe.",
		),
		paths: z
			.array(z.string())
			.optional()
			.describe(
				'Schema paths to describe, e.g. "layout.sections.sectionWrapper". Omit for the collection root.',
			),
		expand: z
			.boolean()
			.optional()
			.describe(
				"Return every node reachable from the root in one response. Ignores paths.",
			),
	}),
	handler: (args, scope) => {
		ensureAllowed(scope, args.collection, "read");

		const { config } = scope.req.payload;
		const expanded =
			args.expand === true
				? reachableSchemaPaths(config, args.collection)
				: undefined;

		const requested =
			expanded?.paths ??
			(args.paths && args.paths.length > 0 ? args.paths : [""]);

		// One bad path returns its own message rather than failing the batch.
		const nodes: unknown[] = requested.map((schemaPath) => {
			try {
				return describeNode(config, args.collection, schemaPath);
			} catch (error) {
				return {
					error: error instanceof Error ? error.message : "Unknown error",
					schemaPath,
				};
			}
		});

		if (expanded?.truncated) {
			nodes.push({
				error: `Result truncated after ${String(REACHABLE_PATHS_LIMIT)} nodes. Request explicit paths instead.`,
			});
		}

		return Promise.resolve(jsonResult(nodes));
	},
};

export { describeSchema };
