import { APIError } from "payload";
import {
	hasDraftsEnabled,
	hasDraftValidationEnabled,
	validateMimeType,
} from "payload/shared";
import { z } from "zod";

import { issueGrant, uploadKvSlug } from "./grant.js";
import { errorResult, jsonResult } from "../result.js";
import { resolveDataPointer, SchemaError } from "../schema/index.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";

import type { DocumentId, ResolvedEntity } from "../entity.js";
import type { McpxToolScope } from "../types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { File, PayloadRequest, SanitizedConfig } from "payload";

const MAX_BYTES = 25 * 1024 * 1024;

// No path separator and no control character.
const FILENAME = /^[^/\\\p{Cc}]+$/u;

const MIME_TYPE = /^[\w.+-]+\/[\w.+-]+$/;

/*
 * Set by the upload endpoint only, so a tool sees bytes only on the request
 * that claimed a grant for exactly this call.
 */
const uploadedFiles = new WeakMap<PayloadRequest, File>();

type CollectionEntity = Extract<ResolvedEntity, { kind: "collection" }>;

const fileSchema = (maxBytes: number) =>
	z.strictObject({
		filename: z.string().max(255).regex(FILENAME),
		mimeType: z.string().max(255).regex(MIME_TYPE),
		size: z.number().int().min(1).max(maxBytes),
	});

/* eslint-disable-next-line @typescript-eslint/consistent-type-definitions */
type FileShape = {
	file: z.ZodOptional<ReturnType<typeof fileSchema>>;
};

/**
 * The largest file accepted: Payload's `upload.limits.fileSize` if set, and
 * never more than 25 MB, since the body is buffered.
 */
export const uploadMaxBytes = (config: SanitizedConfig): number =>
	Math.min(config.upload.limits?.fileSize ?? MAX_BYTES, MAX_BYTES);

/*
 * The `upload.mimeTypes` of a collection this key may send files to, or none.
 * Payload checks the content against them only where they are set.
 */
const allowedMimeTypes = (scope: McpxToolScope, slug: string): string[] => {
	if (!scope.uploads || !scope.collections.writable.includes(slug)) {
		return [];
	}

	const entity = scope.exposure.collections.find(
		(candidate) => candidate.slug === slug,
	);
	const config = scope.req.payload.config.collections.find(
		(candidate) => candidate.slug === slug,
	);

	return entity?.isUpload === true && Array.isArray(config?.upload.mimeTypes)
		? config.upload.mimeTypes
		: [];
};

/**
 * Whether this key may send a file to `slug`: a writable upload collection
 * that sets `upload.mimeTypes`.
 */
export const acceptsFiles = (scope: McpxToolScope, slug: string): boolean =>
	allowedMimeTypes(scope, slug).length > 0;

/**
 * The collections this key may send files to.
 */
export const fileSlugs = (scope: McpxToolScope): string[] =>
	scope.collections.writable.filter((slug) => acceptsFiles(scope, slug));

/**
 * The `file` argument, present only when the key may send a file somewhere.
 */
export const fileShape = (
	scope: McpxToolScope,
	description: (slugs: string) => string,
): FileShape => {
	const slugs = fileSlugs(scope);

	// Unchecked because the runtime shape varies, as with `widen`.
	return (
		slugs.length === 0
			? {}
			: {
					file: fileSchema(uploadMaxBytes(scope.req.payload.config))
						.optional()
						.describe(description(slugs.join(", "))),
				}
	) as FileShape;
};

/**
 * Throws for a `file` sent to an entity that does not accept one, or declared
 * with a type outside its `upload.mimeTypes`. Payload stores the declared
 * type, so it is held to the same list as the content.
 */
export const assertAcceptsFile = (
	scope: McpxToolScope,
	target: ResolvedEntity,
	file: { mimeType: string },
): void => {
	const mimeTypes =
		target.kind === "global" ? [] : allowedMimeTypes(scope, target.slug);

	if (mimeTypes.length === 0) {
		throw new APIError(
			`"${target.slug}" does not accept files through MCP: it is not an upload collection, or it sets no upload.mimeTypes.`,
			400,
		);
	}

	if (!validateMimeType(file.mimeType, mimeTypes)) {
		throw new APIError(
			`"${target.slug}" accepts only ${mimeTypes.join(", ")}, not "${file.mimeType}".`,
			400,
		);
	}
};

/**
 * Attaches the claimed bytes to the request the tool runs on.
 */
export const setUploadedFile = (req: PayloadRequest, file: File): void => {
	uploadedFiles.set(req, file);
};

/**
 * The bytes for this call, or `undefined` before they were sent.
 */
export const uploadedFile = (req: PayloadRequest): File | undefined =>
	uploadedFiles.get(req);

/*
 * Payload deletes the replaced file of a draft unless the latest version is
 * published. A draft that still references the published file would therefore
 * delete the file the live document serves.
 */
const sharesPublishedFile = async (
	req: PayloadRequest,
	entity: CollectionEntity,
	id: DocumentId,
): Promise<boolean> => {
	if (!hasDraftsEnabled(entity.config)) {
		return false;
	}

	const read = {
		collection: entity.slug,
		id,
		depth: 0,
		overrideAccess: true,
		disableErrors: true,
		select: { filename: true, _status: true } as const,
		req,
	};
	const [latest, published] = (await Promise.all([
		req.payload.findByID({ ...read, draft: true }),
		req.payload.findByID({ ...read, draft: false }),
	])) as (null | Record<string, unknown>)[];

	return (
		latest?.["_status"] === "draft" &&
		published?.["_status"] === "published" &&
		latest["filename"] === published["filename"]
	);
};

/*
 * Whether a client could set the field at `path`. A field outside the client
 * surface (hidden, disabled, virtual) is left to hooks that may fill it.
 */
const isClientWritable = (
	scope: McpxToolScope,
	target: { entity: CollectionEntity; data: object },
	path: string,
): boolean => {
	try {
		const resolution = resolveDataPointer(scope.req.payload.config, {
			ref: target.entity,
			doc: target.data,
			pointer: path,
		});

		return (
			resolution.readOnly !== true && resolution.descriptor?.readOnly !== true
		);
	} catch (error) {
		if (error instanceof SchemaError) {
			return false;
		}

		throw error;
	}
};

/**
 * Refuses a file write Payload would turn into data loss: a replace that
 * deletes the published file, or a write that fails validation after the old
 * file is gone. Payload validates only after it moves files, so the merged
 * data is validated here first wherever Payload will validate it, keeping only
 * failures the client can fix. Once the bytes are attached, Payload validates
 * with every hook and the file.
 */
export const fileWriteRefusal = async (
	scope: McpxToolScope,
	target: { entity: CollectionEntity; id?: DocumentId; data: object },
): Promise<CallToolResult | undefined> => {
	const { entity, id } = target;

	if (id !== undefined && (await sharesPublishedFile(scope.req, entity, id))) {
		return errorResult(
			"The file was not replaced: the latest draft still uses the published file, which the replace would delete. Publish or discard the draft first.",
		);
	}

	if (
		uploadedFile(scope.req) !== undefined ||
		(hasDraftsEnabled(entity.config) &&
			!hasDraftValidationEnabled(entity.config))
	) {
		return undefined;
	}

	const { blockers: found } = await collectPublishBlockers(scope.req, {
		doc: { ...target.data, ...(id === undefined ? {} : { id }) },
		entity,
	});
	const blockers = found.filter((blocker) =>
		isClientWritable(scope, target, blocker.path),
	);

	return blockers.length === 0
		? undefined
		: errorResult("Nothing was written: the document fails validation.", {
				validationErrors: blockers,
			});
};

// At the origin of `serverURL` when set, else of the MCP request.
const handoffUrl = (req: PayloadRequest, path: "file" | "upload"): string => {
	const request = new URL(req.url ?? "");
	const url = new URL(req.payload.config.serverURL || request.origin);

	url.pathname = `${request.pathname.replace(/\/+$/, "")}/${path}`;

	return url.toString();
};

// Throws where the endpoint would not offer a handoff.
const grantContext = (req: PayloadRequest) => {
	const slug = uploadKvSlug(req.payload.config);
	const apiKeyId = req.context.mcpx?.apiKeyId;

	if (slug === undefined || apiKeyId === undefined) {
		throw new Error("A handoff was offered without a database KV or key.");
	}

	return { slug, apiKeyId };
};

/**
 * Stores the call as a grant and returns where to PUT its file. Nothing else
 * is written: the PUT runs the same call again with the bytes attached.
 */
export const uploadHandoff = async (
	scope: McpxToolScope,
	call: { tool: string; args: Record<string, unknown> & { file: object } },
): Promise<CallToolResult> => {
	const { req } = scope;
	const { payload } = req;
	const { slug, apiKeyId } = grantContext(req);
	// Before the grant, so a URL that fails to build leaves none behind.
	const url = handoffUrl(req, "upload");
	const { grantId, exp } = await issueGrant(payload, slug, {
		kind: "upload",
		apiKeyId,
		tool: call.tool,
		args: call.args,
		locale: req.locale ?? null,
		fallbackLocale: req.fallbackLocale ?? null,
	});

	return jsonResult({
		upload: {
			url,
			method: "PUT",
			headers: {
				"content-type": (call.args.file as { mimeType: string }).mimeType,
				"x-mcpx-grant": grantId,
			},
			expiresAt: new Date(exp).toISOString(),
			maxBytes: uploadMaxBytes(payload.config),
		},
	});
};

/**
 * The upload collections whose files this key may download. A collection
 * with its own top-level `download` field is left out, since the handoff
 * would overwrite it in the result.
 */
export const downloadSlugs = (scope: McpxToolScope): string[] =>
	scope.uploads
		? scope.collections.readable.filter(
				(slug) =>
					scope.exposure.collections.find(
						(candidate) => candidate.slug === slug,
					)?.isUpload === true &&
					!scope.req.payload.collections[slug]?.config.flattenedFields.some(
						(field) => field.name === "download",
					),
			)
		: [];

/**
 * Stores a grant for the file of a document just read and returns where to
 * GET it.
 */
export const downloadHandoff = async (
	scope: McpxToolScope,
	target: {
		collection: string;
		id: DocumentId;
		draft: boolean;
		locale: null | string;
	},
): Promise<Record<string, unknown>> => {
	const { req } = scope;
	const { slug, apiKeyId } = grantContext(req);
	const url = handoffUrl(req, "file");
	const { grantId, exp } = await issueGrant(req.payload, slug, {
		kind: "download",
		apiKeyId,
		...target,
		fallbackLocale: req.fallbackLocale ?? null,
	});

	return {
		url,
		method: "GET",
		headers: { "x-mcpx-grant": grantId },
		expiresAt: new Date(exp).toISOString(),
	};
};
