import { APIError } from "payload";
import { Pointer } from "rfc6902";
import { z } from "zod";

import { identityOf, refOf, resolveDocument } from "./entity.js";
import {
	depthShape,
	idSchema,
	idShape,
	localeOf,
	localeShape,
	slugsFor,
	entityShape,
	ONE_DOCUMENT_RULE,
} from "./shared.js";
import {
	diffDocuments,
	loadPublished,
	loadVersion,
	readLive,
} from "./versions.js";
import { defineMcpxTool } from "../define-tool.js";
import { errorResult, jsonResult } from "../result.js";
import {
	findRichTextField,
	JSON_POINTER_PATTERN,
	lexicalOutline,
	prototypeSegmentProblem,
	resolveDataPointer,
	SchemaError,
	splitPath,
} from "../schema/index.js";

import type { DocumentId, ResolvedEntity } from "../entity.js";
import type { VersionRead } from "./versions.js";
import type { McpxToolScope } from "../types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const OUTLINE_ERROR =
	'"outline" applies to a rich text field; give "path" for one.';

const DESCRIPTION = `Reads one document, or one subtree of it when "path" is given as a JSON pointer such as "/layout/sections/2". Returns the latest draft by default. Read before patching: the response carries "updatedAt" for expectedUpdatedAt and the indices pointers need.

${ONE_DOCUMENT_RULE}

Set "outline" on a rich text "path" to get a compact positional listing of its nodes instead of the raw editor state.

On an entity with versions, "versionId" (from findVersions) reads that version instead. "diffFrom" returns the RFC 6902 operations turning a version, or "published" (the newest version with published status, regardless of locale), into the document read, in the pointer syntax patchDocument takes and limited to "path" when given. To revert, pass the old version as "versionId" and the latest one from findVersions as "diffFrom", then apply the patch with patchDocument.`;

/** Refuses `versionId` and `diffFrom` where they cannot apply. */
const assertVersionArgs = (
	scope: McpxToolScope,
	target: ResolvedEntity,
	args: {
		draft?: boolean | undefined;
		versionId?: DocumentId | undefined;
		diffFrom?: DocumentId | undefined;
		outline?: boolean | undefined;
	},
): void => {
	if (args.versionId === undefined && args.diffFrom === undefined) {
		return;
	}

	const { collections, globals } = slugsFor(scope, "versions");
	const versioned = target.kind === "collection" ? collections : globals;

	if (!versioned.includes(target.slug)) {
		throw new APIError(`"${target.slug}" keeps no versions.`, 400);
	}

	if (args.versionId !== undefined && args.draft !== undefined) {
		throw new APIError('Pass either "versionId" or "draft", not both.', 400);
	}

	if (args.diffFrom !== undefined && args.outline) {
		throw new APIError('"outline" cannot be combined with "diffFrom".', 400);
	}
};

const diffResult = async (
	scope: McpxToolScope,
	read: VersionRead,
	diff: {
		from: DocumentId;
		to: DocumentId | undefined;
		pointer: Pointer | undefined;
	},
	doc: Record<string, unknown>,
): Promise<CallToolResult> => {
	const from =
		diff.from === "published"
			? await loadPublished(scope, read)
			: await loadVersion(scope, read, diff.from);

	if (!from) {
		return errorResult(
			diff.from === "published"
				? `"${read.target.slug}" has no published version to diff from.`
				: `Version "${String(diff.from)}" not found.`,
		);
	}

	return jsonResult({
		from: from.id,
		to: diff.to ?? "current",
		...(diff.pointer === undefined ? {} : { path: diff.pointer.toString() }),
		patch: diffDocuments(from.version, doc, diff.pointer),
	});
};

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
		...entityShape(scope, "read", {
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
		versionId: idSchema
			.optional()
			.describe(
				'Version to read instead of the document, from findVersions. Only for entities with versions; not with "draft".',
			),
		diffFrom: idSchema
			.optional()
			.describe(
				'Version id, or "published" for the newest published version in any locale, to diff from. Returns {from, to, patch} instead of the document. Only for entities with versions.',
			),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveDocument(scope, args, "read");
		const id = target.kind === "collection" ? target.id : undefined;

		assertVersionArgs(scope, target, args);

		const prototyped = args.path
			? prototypeSegmentProblem(args.path)
			: undefined;

		if (prototyped !== undefined) {
			return errorResult(prototyped);
		}

		let pointer: Pointer | undefined;

		try {
			pointer = args.path ? Pointer.fromJSON(args.path) : undefined;
		} catch {
			return errorResult(`"${String(args.path)}" is not a valid JSON pointer.`);
		}

		const read = {
			target,
			id,
			depth: args.depth ?? 0,
			locale: localeOf(scope, args.locale),
		};
		const doc =
			args.versionId === undefined
				? await readLive(scope, read, { draft: args.draft ?? true })
				: (await loadVersion(scope, read, args.versionId))?.version;

		if (!doc) {
			return errorResult(`Version "${String(args.versionId)}" not found.`);
		}

		if (args.diffFrom !== undefined) {
			return await diffResult(
				scope,
				read,
				{ from: args.diffFrom, to: args.versionId, pointer },
				doc,
			);
		}

		if (pointer === undefined) {
			if (args.outline) {
				return errorResult(OUTLINE_ERROR);
			}

			return jsonResult(doc);
		}

		const path = pointer.toString();
		const value = pointer.get(doc) as unknown;

		const envelope = {
			...identityOf(target, id),
			status: doc["_status"],
			updatedAt: doc["updatedAt"],
			path,
		};

		if (!args.outline) {
			return jsonResult({ ...envelope, value });
		}

		/* The resolver throws for a path no field answers to. */
		let resolution;

		try {
			resolution = resolveDataPointer(scope.req.payload.config, {
				doc,
				pointer: path,
				ref: refOf(target),
			});
		} catch (error) {
			if (!(error instanceof SchemaError)) {
				throw error;
			}

			return errorResult(error.message);
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
			outline: lexicalOutline(value, path, field),
		});
	},
});
