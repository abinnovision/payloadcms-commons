import { APIError } from "payload";
import { z } from "zod";

import { withRequestLocale } from "./document.js";
import {
	defineMcpxTool,
	isToolEnabled,
	toolInputSchema,
} from "../define-tool.js";
import {
	CONFIRMATIONS_PER_KEY,
	claimConfirmation,
	readConfirmation,
} from "../grants/confirmation.js";
import { grantContext } from "../grants/grant.js";
import { jsonResult, parseResult } from "../result.js";

import type { DocumentId } from "../entity.js";
import type { Confirmation } from "../grants/confirmation.js";
import type {
	McpxAnyTool,
	McpxConfirmation,
	McpxToolExtra,
	McpxToolScope,
} from "../types.js";
import type { PayloadRequest } from "payload";

const DESCRIPTION = `Runs calls that returned a "confirmation", once the user approved them in the admin panel. Returns one result per id, in the order given: "done" with the call's "result", "pending" while it awaits a decision, "skipped" with a "reason" when it no longer passes its checks, or "refused" when it was rejected, expired, already run or is unknown. A pending id stays usable; no other id can run again.`;

const NO_LONGER_ALLOWED = "This key no longer allows this call.";

// A confirmed run executes the stored call and never stores a new one.
const CONFIRMED: McpxConfirmation = {
	confirmed: true,
	request: () =>
		Promise.reject(new Error("A confirmed run cannot request a confirmation.")),
};

type Result =
	| { status: "done"; result: unknown }
	| { status: "pending" | "refused" }
	| { status: "skipped"; reason: string };

type Outcome = Result & { id: string };

/*
 * Runs the stored call as the tool would on a fresh request: the scope is the
 * key's current one, the arguments are parsed against today's schema and the
 * locale is the one of the original call. A failure is reported on its entry,
 * so the others still run.
 */
const execute = async (
	tool: McpxAnyTool,
	confirmation: Confirmation,
	scope: McpxToolScope,
	extra: McpxToolExtra,
): Promise<Result> => {
	const { req } = scope;
	const args = toolInputSchema(tool, scope).safeParse(confirmation.args);

	if (!args.success) {
		return { status: "skipped", reason: NO_LONGER_ALLOWED };
	}

	return await withRequestLocale(req, async (): Promise<Result> => {
		req.locale = confirmation.locale;
		req.fallbackLocale = confirmation.fallbackLocale;

		try {
			const result = await tool.handler({
				args: args.data as never,
				scope,
				req,
				extra,
				confirmation: CONFIRMED,
			});
			const data = parseResult(result);

			return result.isError === true
				? { status: "skipped", reason: String(data["error"]) }
				: { status: "done", result: data };
		} catch (error) {
			if (error instanceof APIError && error.isPublic) {
				return { status: "skipped", reason: error.message };
			}

			req.payload.logger.error({
				err: error,
				msg: "[payloadcms-mcpx] Confirmed call failed.",
			});

			return { status: "skipped", reason: "Internal error" };
		}
	});
};

/*
 * The approved call of `id`, claimed, or the outcome to report instead. A
 * storage failure is reported on this entry alone, so the results of the
 * entries before it still reach the client.
 */
const claimApproved = async (
	req: PayloadRequest,
	slug: string,
	apiKeyId: DocumentId,
	id: string,
): Promise<Confirmation | Result> => {
	const { payload } = req;

	try {
		const confirmation = await readConfirmation(payload, slug, apiKeyId, id);

		if (confirmation?.state === "pending") {
			return { status: "pending" };
		}

		return confirmation?.state === "approved" &&
			(await claimConfirmation(payload, slug, apiKeyId, id, confirmation.exp))
			? confirmation
			: { status: "refused" };
	} catch (error) {
		payload.logger.error({
			err: error,
			msg: "[payloadcms-mcpx] Could not claim a confirmed call.",
		});

		return { status: "skipped", reason: "Internal error" };
	}
};

/**
 * Runs approved calls of the confirmable tools in `tools`, which is read per
 * call so the list may include this tool. Registered when the key may call one
 * of them. Each call claims its entry first, so it runs at most once.
 */
export const createRunConfirmed = (tools: () => McpxAnyTool[]): McpxAnyTool =>
	defineMcpxTool({
		name: "runConfirmed",
		description: DESCRIPTION,
		annotations: { destructiveHint: true, openWorldHint: false },
		isEnabled: (scope) =>
			tools().some(
				(tool) => tool.confirm !== undefined && isToolEnabled(tool, scope),
			),
		inputSchema: {
			ids: z
				.array(z.string().max(64))
				.min(1)
				.max(CONFIRMATIONS_PER_KEY)
				.describe('"id" of each "confirmation".'),
		},
		handler: async ({ args, scope, extra }) => {
			const { req } = scope;
			const { slug, apiKeyId } = grantContext(req);

			const outcomes: Outcome[] = [];

			/*
			 * One at a time and in order: each call owns its transaction, and a
			 * later call may depend on an earlier one.
			 */
			for (const id of args.ids) {
				// eslint-disable-next-line no-await-in-loop
				const confirmation = await claimApproved(req, slug, apiKeyId, id);

				if (!("tool" in confirmation)) {
					outcomes.push({ id, ...confirmation });
					continue;
				}

				const tool = tools().find(
					(candidate) =>
						candidate.name === confirmation.tool &&
						candidate.confirm !== undefined,
				);

				const result: Result =
					tool && isToolEnabled(tool, scope)
						? // eslint-disable-next-line no-await-in-loop
							await execute(tool, confirmation, scope, extra)
						: { status: "skipped", reason: NO_LONGER_ALLOWED };

				outcomes.push({ id, ...result });
			}

			return jsonResult({ results: outcomes });
		},
	});
