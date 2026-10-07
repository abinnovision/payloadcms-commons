import { formatAdminURL } from "payload/shared";

import { respond } from "./http.js";
import {
	CONFIRMATIONS_PATH,
	DECISIONS,
} from "../api-keys/confirmation-view.js";
import { relationId } from "../auth/resolve.js";
import {
	CONFIRMATIONS_PER_KEY,
	decideConfirmations,
	issueConfirmation,
	listConfirmations,
} from "../grants/confirmation.js";
import { grantContext, grantKvSlug, rowHandle } from "../grants/grant.js";
import { isPlainObject } from "../guards.js";
import { publicOrigin } from "../request.js";
import { jsonResult } from "../result.js";
import { BUILTIN_TOOLS } from "../tools/builtin.js";

import type {
	ConfirmationDecision,
	ConfirmationView,
} from "../api-keys/confirmation-view.js";
import type { DocumentId } from "../entity.js";
import type { NormalizedOptions } from "../options.js";
import type { McpxAnyTool, McpxConfirmation, McpxToolScope } from "../types.js";
import type { Endpoint, PayloadHandler, PayloadRequest } from "payload";

const confirmableTool = (name: string): McpxAnyTool | undefined =>
	BUILTIN_TOOLS.find((tool) => tool.name === name && tool.confirm);

// The key's own edit view, where its user decides.
const keyViewUrl = (
	req: PayloadRequest,
	options: NormalizedOptions,
	apiKeyId: DocumentId,
): string => {
	return formatAdminURL({
		adminRoute: req.payload.config.routes.admin,
		path: `/collections/${options.apiKeysSlug}/${String(apiKeyId)}`,
		serverURL: publicOrigin(req),
	});
};

/**
 * The `confirmation` a confirmable tool's handler gets on an MCP call. Its
 * `request` stores the call for the key's user to approve and answers with
 * the confirmation the client passes to `runConfirmed`.
 */
export const confirmationFor = (
	tool: string,
	scope: McpxToolScope,
	options: NormalizedOptions,
): McpxConfirmation => ({
	confirmed: false,
	request: async (args) => {
		const { req } = scope;
		const { slug, apiKeyId } = grantContext(req);

		// Before the entry, so a URL that fails to build leaves none behind.
		const view = keyViewUrl(req, options, apiKeyId);
		const { id, exp } = await issueConfirmation(req.payload, slug, {
			apiKeyId,
			tool,
			args,
			locale: req.locale ?? null,
			fallbackLocale: req.fallbackLocale ?? null,
		});

		return jsonResult({
			confirmation: {
				id,
				url: `${view}?confirmation=${encodeURIComponent(id)}`,
				expiresAt: new Date(exp).toISOString(),
			},
		});
	},
});

/*
 * The KV slug and key id when the session user is the user of the key named
 * by `keyId`, else the refusal to send. The key is read with full access, so
 * a looser `read` rule on the key collection does not let another user
 * decide.
 */
const authorize = async (
	req: PayloadRequest,
	options: NormalizedOptions,
	keyId: unknown,
): Promise<Response | { slug: string; apiKeyId: DocumentId }> => {
	const slug = grantKvSlug(req.payload.config);

	if (slug === undefined) {
		return respond(404, { error: "Confirmations are not available." });
	}

	if (req.user?.collection !== options.userCollection) {
		return respond(401, { error: "Sign in as the user of this key." });
	}

	const key =
		typeof keyId === "string" || typeof keyId === "number"
			? ((await req.payload
					.findByID({
						collection: options.apiKeysSlug,
						id: keyId,
						depth: 0,
						overrideAccess: true,
						disableErrors: true,
						select: { user: true },
					})
					.catch(() => null)) as null | { id: DocumentId; user?: unknown })
			: null;
	const user = relationId(key?.user);

	if (!key || user === undefined || String(user) !== String(req.user.id)) {
		return respond(403, {
			error: "Only the user of this key may decide on its calls.",
		});
	}

	return { slug, apiKeyId: key.id };
};

/*
 * A summary that fails to build still lists the call, so it can be rejected.
 */
const viewOf = async (
	req: PayloadRequest,
	entry: Awaited<ReturnType<typeof listConfirmations>>[number],
	highlight: string | undefined,
): Promise<ConfirmationView> => {
	const { tool: name, args } = entry.confirmation;
	const tool = confirmableTool(name);
	const summary = await tool?.confirm
		?.summarize({ args }, req)
		.catch((error: unknown) => {
			req.payload.logger.warn({
				err: error,
				msg: "[payloadcms-mcpx] Could not summarize a confirmation.",
			});

			return undefined;
		});

	return {
		handle: entry.handle,
		tool: name,
		group: tool?.confirm?.label ?? name,
		highlighted: entry.handle === highlight,
		summary: summary ?? { label: name, permanent: true },
	};
};

/**
 * Lists the pending calls of `?key=`, for its user's admin session. A
 * `?confirmation=` id marks its call as highlighted.
 */
const listHandler =
	(options: NormalizedOptions): PayloadHandler =>
	async (req) => {
		const allowed = await authorize(req, options, req.searchParams.get("key"));

		if (allowed instanceof Response) {
			return allowed;
		}

		const { payload } = req;
		const highlighted = req.searchParams.get("confirmation");
		const highlight =
			highlighted === null ? undefined : rowHandle(payload, highlighted);
		const entries = (
			await listConfirmations(payload, allowed.slug, allowed.apiKeyId)
		).filter((entry) => entry.confirmation.state === "pending");
		const confirmations: ConfirmationView[] = [];

		// In turn, since the summaries share `req`.
		for (const entry of entries) {
			// eslint-disable-next-line no-await-in-loop
			confirmations.push(await viewOf(req, entry, highlight));
		}

		return respond(200, { confirmations });
	};

/**
 * Approves or rejects pending calls of a key, for its user's admin session.
 * The body is `{ key, handles, decision }`. Answers with the handles it
 * changed; a call already decided, run or expired is left out.
 */
const decideHandler =
	(options: NormalizedOptions): PayloadHandler =>
	async (req) => {
		const body: unknown = await req.json?.().catch(() => undefined);
		const allowed = await authorize(
			req,
			options,
			isPlainObject(body) ? body["key"] : undefined,
		);

		if (allowed instanceof Response) {
			return allowed;
		}

		const handles = isPlainObject(body) ? body["handles"] : undefined;
		const decision = isPlainObject(body) ? body["decision"] : undefined;
		const isDecision = (value: unknown): value is ConfirmationDecision =>
			DECISIONS.some((candidate) => candidate === value);

		if (
			!Array.isArray(handles) ||
			handles.length > CONFIRMATIONS_PER_KEY ||
			!handles.every((handle) => typeof handle === "string") ||
			!isDecision(decision)
		) {
			return respond(400, {
				error: `Send "handles", at most ${String(CONFIRMATIONS_PER_KEY)}, and a "decision" of "approved" or "rejected".`,
			});
		}

		const decided = await decideConfirmations(
			req.payload,
			allowed.slug,
			allowed.apiKeyId,
			handles,
			decision,
		);

		return respond(200, { decided });
	};

/**
 * The endpoints the API key's edit view reads and decides through.
 */
export const confirmationEndpoints = (
	options: NormalizedOptions,
): Endpoint[] => [
	{
		path: `${options.endpointPath}${CONFIRMATIONS_PATH}`,
		method: "get",
		handler: listHandler(options),
	},
	{
		path: `${options.endpointPath}${CONFIRMATIONS_PATH}`,
		method: "post",
		handler: decideHandler(options),
	},
];
