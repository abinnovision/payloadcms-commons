import { APIError } from "payload";
import { Pointer } from "rfc6902";
import { z } from "zod";

import { identityOf, resolveDocument } from "./document.js";
import {
	depthShape,
	idSchema,
	idShape,
	localeOf,
	localeShape,
	READ_LOCALE_DESCRIPTION,
	slugsFor,
	entityShape,
	widen,
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
import { downloadHandoff, downloadSlugs } from "../upload/file.js";

import type { DocumentId, ResolvedEntity } from "../entity.js";
import type { VersionRead } from "./versions.js";
import type { McpxToolScope } from "../types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const OUTLINE_ERROR =
	'"outline" applies to a rich text field; give "path" for one.';

const VERSION_PARAGRAPH = `

"versionId" and "diffFrom" work where findVersions does. To revert, call getDocument with the old version as "versionId", the version findVersions marks "latest" as "diffFrom" and the locale you will write, then apply the returned "patch" with patchDocument.`;

const DESCRIPTION = `Reads one document or global, or with "path" only the value at that pointer. Returns the latest draft by default, with the "updatedAt" a write takes as "expectedUpdatedAt".`;

// Whether the key reaches any entity whose version history the config exposes.
const exposesVersions = (scope: McpxToolScope): boolean => {
	const { collections, globals } = slugsFor(scope, "versions");

	return collections.length + globals.length > 0;
};

// Refuses `versionId` and `diffFrom` where they cannot apply.
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
		throw new APIError(
			`"${target.slug}" does not expose version history.`,
			400,
		);
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

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type VersionShape = {
	versionId: z.ZodOptional<typeof idSchema>;
	diffFrom: z.ZodOptional<typeof idSchema>;
};

/*
 * Left out for a key that reaches no entity with exposed versions, so the
 * client is never offered what the refusal would answer.
 */
const versionShape = (scope: McpxToolScope): VersionShape => {
	if (!exposesVersions(scope)) {
		return widen<VersionShape>({});
	}

	return widen<VersionShape>({
		versionId: idSchema
			.optional()
			.describe('From findVersions. Not with "draft".'),
		diffFrom: idSchema
			.optional()
			.describe(
				'Version id, or "published" for the newest version published in any locale. Returns {from, to, patch}, the JSON Patch from that version to what is read.',
			),
	});
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type DownloadShape = {
	download: z.ZodOptional<z.ZodLiteral<true>>;
};

// Left out for a key that can download no file.
const downloadShape = (scope: McpxToolScope): DownloadShape => {
	const slugs = downloadSlugs(scope);

	return widen<DownloadShape>(
		slugs.length === 0
			? {}
			: {
					download: z
						.literal(true)
						.optional()
						.describe(
							`Only for ${slugs.join(", ")}. Adds "download": GET its "url" with its "headers" once, within 5 minutes, for the file. Not with "path", "versionId" or "diffFrom".`,
						),
				},
	);
};

// Refuses `download` where it cannot apply.
const assertDownloadArgs = (
	scope: McpxToolScope,
	target: ResolvedEntity,
	args: {
		path?: string | undefined;
		versionId?: DocumentId | undefined;
		diffFrom?: DocumentId | undefined;
	},
): void => {
	if (target.kind === "global" || !downloadSlugs(scope).includes(target.slug)) {
		throw new APIError(`"${target.slug}" has no file to download.`, 400);
	}

	if (
		args.path !== undefined ||
		args.versionId !== undefined ||
		args.diffFrom !== undefined
	) {
		throw new APIError(
			'"download" cannot be combined with "path", "versionId" or "diffFrom".',
			400,
		);
	}
};

// The document with a handoff for its file, or a refusal when it has none.
const withDownload = async (
	scope: McpxToolScope,
	doc: Record<string, unknown>,
	target: Parameters<typeof downloadHandoff>[1],
): Promise<CallToolResult> =>
	typeof doc["filename"] === "string"
		? jsonResult({ ...doc, download: await downloadHandoff(scope, target) })
		: errorResult("This document has no file to download.");

/**
 * With `path` the handler returns the subtree plus the `id`, `_status` and
 * `updatedAt` a client needs to write back, so reading one branch still gives
 * the `expectedUpdatedAt` timestamp without a second call.
 */
export const getDocument = defineMcpxTool({
	name: "getDocument",
	description: (scope) =>
		exposesVersions(scope) ? DESCRIPTION + VERSION_PARAGRAPH : DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: (scope) =>
		scope.collections.readable.length + scope.globals.readable.length > 0,
	inputSchema: (scope) => ({
		...entityShape(scope, "read"),
		...idShape(scope, "read"),
		path: z
			.string()
			.regex(JSON_POINTER_PATTERN)
			.optional()
			.describe('e.g. "/layout/sections/0".'),
		...depthShape(scope),
		...localeShape(scope, {
			required: false,
			description: READ_LOCALE_DESCRIPTION,
		}),
		draft: z
			.boolean()
			.optional()
			.describe("Default true. false reads the published version."),
		outline: z
			.boolean()
			.optional()
			.describe(
				'With "path" at a rich text field: list each node\'s pointer, type, "version" and text.',
			),
		...versionShape(scope),
		...downloadShape(scope),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveDocument(scope, args, "read");

		assertVersionArgs(scope, target, args);

		if (args.download) {
			assertDownloadArgs(scope, target, args);
		}

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

			return args.download && args.id !== undefined
				? await withDownload(scope, doc, {
						collection: target.slug,
						id: args.id,
						draft: args.draft ?? true,
						locale: read.locale ?? null,
					})
				: jsonResult(doc);
		}

		const path = pointer.toString();
		const value = pointer.get(doc) as unknown;

		const envelope = {
			...identityOf(target, args.id),
			status: doc["_status"],
			updatedAt: doc["updatedAt"],
			path,
		};

		if (!args.outline) {
			return jsonResult({ ...envelope, value });
		}

		// The resolver throws for a path no field answers to.
		let resolution;

		try {
			resolution = resolveDataPointer(scope.req.payload.config, {
				doc,
				pointer: path,
				ref: target,
			});
		} catch (error) {
			if (!(error instanceof SchemaError)) {
				throw error;
			}

			return errorResult(error.message);
		}

		/*
		 * A pointer that continues into the editor state resolves to the same
		 * descriptor, and outlining a node of it would return nothing.
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
