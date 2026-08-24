import { Pointer } from "rfc6902";
import { z } from "zod";

import {
	depthShape,
	idShape,
	localeOf,
	localeShape,
	targetShape,
} from "./shared.js";
import { requireIdFor, resolveTarget } from "./target.js";
import { errorResult, jsonResult } from "../endpoint/result.js";

import type { BuiltinTool } from "./types.js";

const DESCRIPTION = `Reads one document, or one subtree of it when "path" is given as a JSON pointer such as "/layout/sections/2". Returns the latest draft by default. Read before patching: the response carries "updatedAt" for expectedUpdatedAt and the indices pointers need.

Pass exactly one of "collection" and "global". "id" is required with "collection" and must be omitted with "global", because a global is a singleton.`;

interface Args {
	collection?: string;
	depth?: number;
	draft?: boolean;
	global?: string;
	id?: number | string;
	locale?: string;
	path?: string;
}

const getDocument: BuiltinTool<Args> = {
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
	}),
	handler: async (args, scope) => {
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
			return jsonResult(doc);
		}

		let value: unknown;

		try {
			value = Pointer.fromJSON(args.path).get(doc) as unknown;
		} catch {
			return errorResult(`"${args.path}" is not a valid JSON pointer.`);
		}

		return jsonResult({
			...(target.kind === "collection"
				? { id: doc["id"] }
				: { global: target.slug }),
			status: doc["_status"],
			updatedAt: doc["updatedAt"],
			path: args.path,
			value,
		});
	},
};

export { getDocument };
