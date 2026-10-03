import { z } from "zod";

import { resolveEntity } from "./document.js";
import { entityShape } from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { translatorFor } from "../i18n.js";
import { jsonResult } from "../result.js";
import {
	nodeDescriber,
	nodePropertiesFor,
	REACHABLE_PATHS_LIMIT,
	reachableSchemaPaths,
	SchemaError,
} from "../schema/index.js";

import type { FieldDescriptor } from "../schema/index.js";

const DESCRIPTION = `Describes the fields of a collection or global, one node at a time. Use it before a query or a write.

Without "paths" it returns the top-level node. A node has a "schemaPath", its "fields" and "next". Each field has a "path" relative to its node, a "type" and constraints such as "required", "localized", "readOnly", "options" and "relationTo". A "blocks" field lists the block slugs it accepts, and a "richText" field lists its node types in "nodes". "next" holds the schema paths of the blocks and rich text node types with fields below the node, e.g. "/layout/sections/sectionWrapper" or "/content/block/callout". Pass them as "paths" to describe those nodes. A block can accept different children at another position, so describe it at the schema path where it is used.

When the response contains a rich text field, the response also carries a "nodeProperties" entry: the properties each node type must carry. Build every rich text node from it. Upload nodes have no schema path.

id, _status, createdAt and updatedAt are not listed and cannot be written. A field marked "readOnly" cannot be written either.`;

const PATHS_LIMIT = 400;

/**
 * Describes each requested path independently and returns a per-path error
 * object instead of failing the call, so a client exploring several branches
 * keeps the nodes that resolved. `expand` replaces the requested paths with
 * every node reachable from the root and adds a truncation notice past
 * {@link REACHABLE_PATHS_LIMIT}.
 */
export const describeSchema = defineMcpxTool({
	name: "describeSchema",
	description: DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: (scope) =>
		scope.collections.readable.length + scope.globals.readable.length > 0,
	inputSchema: (scope) => ({
		...entityShape(scope, "read", 'Instead of "collection".'),
		paths: z
			.array(z.string())
			.max(PATHS_LIMIT)
			.optional()
			.describe('Schema paths from "next". Omit for the top-level node.'),
		expand: z
			.boolean()
			.optional()
			.describe(
				'Return the top-level node and every node below it in one response, instead of "paths".',
			),
	}),
	handler: ({ args, scope }) => {
		const ref = resolveEntity(scope, args, "read");

		const { config } = scope.req.payload;
		const describeNode = nodeDescriber(translatorFor(scope.req.i18n));
		const expanded =
			args.expand === true ? reachableSchemaPaths(config, ref) : undefined;

		const requested =
			expanded?.paths ??
			(args.paths && args.paths.length > 0 ? args.paths : [""]);

		const failures: unknown[] = [];

		const nodes: unknown[] = requested.map((schemaPath) => {
			try {
				return describeNode(config, ref, schemaPath);
			} catch (error) {
				if (error instanceof SchemaError) {
					return { error: error.message, schemaPath };
				}

				failures.push(error);

				return { error: "Internal error", schemaPath };
			}
		});

		// One root cause usually fails every path, so it is logged once.
		if (failures.length > 0) {
			scope.req.payload.logger.error({
				err: failures[0],
				msg: `[payloadcms-mcpx] Describing ${String(failures.length)} schema paths failed.`,
			});
		}

		/*
		 * Stated once for the whole response, not per field, because what a node
		 * type must carry does not vary with where it is written. A field's own
		 * "nodes" says which of these apply to it.
		 */
		const nodeTypes = nodes.flatMap((node) =>
			((node as { fields?: FieldDescriptor[] }).fields ?? []).flatMap(
				(field) => field.nodes ?? [],
			),
		);

		if (nodeTypes.length > 0) {
			nodes.push({ nodeProperties: nodePropertiesFor(nodeTypes) });
		}

		if (expanded?.truncated) {
			nodes.push({
				error: `Result truncated after ${String(REACHABLE_PATHS_LIMIT)} nodes. Request explicit paths instead.`,
			});
		}

		return jsonResult(nodes);
	},
});
