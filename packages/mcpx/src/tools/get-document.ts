import { Pointer } from "rfc6902";
import { z } from "zod";

import {
	collectionEnum,
	depthShape,
	ensureAllowed,
	idSchema,
	localeOf,
	localeShape,
} from "./shared.js";
import { jsonResult } from "../endpoint/result.js";

import type { BuiltinTool } from "./types.js";

const DESCRIPTION = `Reads one document, or one subtree of it when "path" is given as a JSON pointer such as "/layout/sections/2". Returns the latest draft by default. Read before patching: the response carries "updatedAt" for expectedUpdatedAt and the indices pointers need.`;

interface Args {
	collection: string;
	depth?: number;
	draft?: boolean;
	id: number | string;
	locale?: string;
	path?: string;
}

const getDocument: BuiltinTool<Args> = {
	name: "getDocument",
	description: DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: (scope) => scope.readable.length > 0,
	inputSchema: (scope) => ({
		collection: collectionEnum(scope.readable).describe(
			"Collection holding the document.",
		),
		id: idSchema,
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
		ensureAllowed(scope, args.collection, "read");

		const locale = localeOf(scope, args.locale);
		const doc = (await scope.req.payload.findByID({
			collection: args.collection,
			id: args.id,
			depth: args.depth ?? 0,
			draft: args.draft ?? true,
			overrideAccess: false,
			req: scope.req,
			...(locale === undefined ? {} : { locale }),
		})) as Record<string, unknown>;

		if (args.path === undefined || args.path === "") {
			return jsonResult(doc);
		}

		return jsonResult({
			id: doc["id"],
			status: doc["_status"],
			updatedAt: doc["updatedAt"],
			path: args.path,
			value: Pointer.fromJSON(args.path).get(doc) as unknown,
		});
	},
};

export { getDocument };
