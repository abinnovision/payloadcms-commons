import { Pointer } from "rfc6902";
import { z } from "zod";

import {
	depthShape,
	idShape,
	localeOf,
	localeShape,
	targetShape,
} from "./shared.js";
import { refOf, requireIdFor, resolveTarget } from "./target.js";
import { errorResult, jsonResult } from "../result.js";
import {
	findRichTextField,
	JSON_POINTER_PATTERN,
	lexicalOutline,
	resolveDataPointer,
	splitPath,
} from "../schema/index.js";
import { defineMcpxTool } from "../types.js";

const OUTLINE_ERROR =
	'"outline" applies to a rich text field; give "path" for one.';

const DESCRIPTION = `Reads one document, or one subtree of it when "path" is given as a JSON pointer such as "/layout/sections/2". Returns the latest draft by default. Read before patching: the response carries "updatedAt" for expectedUpdatedAt and the indices pointers need.

Pass exactly one of "collection" and "global". "id" is required with "collection" and must be omitted with "global", because a global is a singleton.

Set "outline" on a rich text "path" to get a compact positional listing of its nodes instead of the raw editor state.`;

/**
 * With `path` the handler returns the subtree plus the `id`, `_status` and
 * `updatedAt` a client needs to write back, so a caller reading one branch
 * still gets the timestamp `expectedUpdatedAt` wants without a second call.
 */
export const getDocument = defineMcpxTool({
	name: "getDocument",
	description: DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: (scope) =>
		scope.readable.length + scope.readableGlobals.length > 0,
	inputSchema: (scope) => ({
		...targetShape(scope, "read", {
			collection: "Collection holding the document.",
			global: "Global to read.",
		}),
		...idShape(scope, "read"),
		path: z
			.string()
			.regex(JSON_POINTER_PATTERN)
			.optional()
			.describe(
				'JSON pointer to return only a subtree, e.g. "/layout/sections/0".',
			),
		...depthShape(scope),
		...localeShape(scope, {
			required: false,
			description: "Locale to read. Defaults to the default locale.",
		}),
		draft: z
			.boolean()
			.optional()
			.describe("Return the latest draft. Default true."),
		outline: z
			.boolean()
			.optional()
			.describe(
				'For a rich text field, return a compact positional outline instead of the editor state. Requires "path".',
			),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveTarget(scope, args, "read");
		const id = requireIdFor(target, args.id);

		const locale = localeOf(scope, args.locale);
		const shared = {
			depth: args.depth ?? 0,
			draft: args.draft ?? true,
			overrideAccess: false,
			req: scope.req,
			...(locale === undefined ? {} : { locale }),
		};

		const doc = (await (target.kind === "collection"
			? scope.req.payload.findByID({
					...shared,
					collection: target.slug,
					id: id as number | string,
				})
			: scope.req.payload.findGlobal({
					...shared,
					slug: target.slug,
				}))) as Record<string, unknown>;

		if (args.path === undefined || args.path === "") {
			if (args.outline) {
				return errorResult(OUTLINE_ERROR);
			}

			return jsonResult(doc);
		}

		let value: unknown;

		try {
			value = Pointer.fromJSON(args.path).get(doc) as unknown;
		} catch {
			return errorResult(`"${args.path}" is not a valid JSON pointer.`);
		}

		const envelope = {
			...(target.kind === "collection"
				? { id: doc["id"] }
				: { global: target.slug }),
			status: doc["_status"],
			updatedAt: doc["updatedAt"],
			path: args.path,
		};

		if (!args.outline) {
			return jsonResult({ ...envelope, value });
		}

		/* The resolver throws for a path no field answers to. */
		let resolution;

		try {
			resolution = resolveDataPointer(scope.req.payload.config, {
				doc,
				pointer: args.path,
				ref: refOf(target),
			});
		} catch (error) {
			return errorResult(
				error instanceof Error ? error.message : OUTLINE_ERROR,
			);
		}

		/*
		 * A pointer running on into the state resolves to the same descriptor,
		 * and outlining one node of it would answer with nothing.
		 */
		const field =
			resolution.descriptor?.type === "richText" && !resolution.lexical
				? findRichTextField(
						resolution.fields,
						splitPath(resolution.descriptor.path),
					)
				: undefined;

		if (!field) {
			return errorResult(OUTLINE_ERROR);
		}

		return jsonResult({
			...envelope,
			outline: lexicalOutline(value, args.path, field),
		});
	},
});
