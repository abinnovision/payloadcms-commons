import { ValidationError } from "payload";

import { ownerWhere } from "./owner.js";
import { setAgentKeyEnabled } from "../keys/manager.js";
import { createSidecarClient, SidecarError } from "../sidecar/client.js";

import type { NormalizedOptions } from "../options.js";
import type { RelationValue } from "../protocol/owner.js";
import type {
	CollectionAfterChangeHook,
	CollectionBeforeChangeHook,
	CollectionConfig,
	Where,
} from "payload";

// Written by the plugin only, which bypasses access control.
const SERVER_ONLY = { create: () => false, update: () => false };

const AGENT_RUNS: Where = { kind: { in: ["reactive", "ambient"] } };

interface ThreadRow {
	id: number | string;
	status?: null | string;
}

/*
 * A user may archive a thread. Every other status follows the run, which
 * only the plugin's own writes report.
 */
const guardStatus: CollectionBeforeChangeHook<ThreadRow> = ({
	collection,
	data,
	operation,
	originalDoc,
	req,
}) => {
	const { status } = data;

	if (
		operation === "update" &&
		!req.context.flue?.internal &&
		status !== undefined &&
		status !== originalDoc?.status &&
		status !== "archived"
	) {
		throw new ValidationError(
			{
				collection: collection.slug,
				errors: [{ path: "status", message: "A thread can only be archived." }],
				req,
			},
			req.t,
		);
	}

	return data;
};

interface StoredThread {
	agent?: string;
	conversationId?: string;
	createdBy?: RelationValue;
}

/*
 * The run of an archived thread stops whatever the row's status says, which
 * may lag the run. Archiving a running thread also disables the key of its
 * user and agent. Both are best effort, as the key expires on its own; the
 * answer does not wait for the sidecar. The exchange refuses the handle of an
 * archived thread from the row itself.
 */
const onArchive =
	(settings: NormalizedOptions): CollectionAfterChangeHook<ThreadRow> =>
	async ({ doc, operation, previousDoc, req }) => {
		if (
			operation !== "update" ||
			doc.status !== "archived" ||
			previousDoc.status === "archived"
		) {
			return doc;
		}

		const { payload } = req;

		// `doc` and `previousDoc` of a REST update lack the hidden `conversationId`.
		const stored = (await payload.findByID({
			collection: settings.threads.slug,
			id: previousDoc.id,
			depth: 0,
			overrideAccess: true,
			showHiddenFields: true,
			select: {
				agent: true,
				conversationId: true,
				createdBy: true,
			},
			req,
		})) as StoredThread;

		if (!stored.agent) {
			return doc;
		}

		const { agent, conversationId, createdBy } = stored;
		const log = (msg: string) => (error: unknown) => {
			payload.logger.error({ err: error, msg: `[payloadcms-flue] ${msg}` });
		};

		if (conversationId) {
			const failed = log("Could not abort the run of an archived thread.");

			// A conversation Flue has not seen has no run to stop.
			void createSidecarClient(settings.sidecar)
				.abort(agent, conversationId)
				.catch((error: unknown) => {
					if (!(error instanceof SidecarError && error.status === 404)) {
						failed(error);
					}
				});
		}

		if (
			previousDoc.status === "running" &&
			createdBy?.relationTo === settings.mcpx.userCollection
		) {
			await setAgentKeyEnabled(payload, settings, {
				userId: createdBy.value as number | string,
				agent,
				enabled: false,
				req,
			}).catch(log("Could not disable the key of an archived thread."));
		}

		return doc;
	};

/**
 * The `flue-threads` collection. Rows are created and moved through the run
 * by the plugin; their user may rename, mark read and archive them.
 */
export const createThreadsCollection = (
	settings: NormalizedOptions,
): CollectionConfig => {
	const { userCollection } = settings.mcpx;

	return {
		slug: settings.threads.slug,
		versions: false,
		// The owner is `createdBy`, compared by collection and id.
		authorship: true,
		admin: { hidden: true, useAsTitle: "title" },
		access: {
			create: () => false,
			delete: () => false,
			update: ({ req }) => ownerWhere(req, userCollection),
			read: ({ req }) => {
				const owned = ownerWhere(req, userCollection);

				if (!settings.threads.readAgentRuns(req)) {
					return owned;
				}

				return owned ? { or: [owned, AGENT_RUNS] } : AGENT_RUNS;
			},
		},
		hooks: {
			beforeChange: [guardStatus],
			afterChange: [onArchive(settings)],
		},
		fields: [
			{
				name: "agent",
				type: "text",
				required: true,
				index: true,
				access: SERVER_ONLY,
			},
			{
				name: "conversationId",
				type: "text",
				unique: true,
				hidden: true,
				access: SERVER_ONLY,
			},
			{
				name: "handleHash",
				type: "text",
				unique: true,
				hidden: true,
				access: SERVER_ONLY,
			},
			{ name: "title", type: "text", maxLength: 120 },
			{
				name: "agentTitle",
				type: "text",
				maxLength: 120,
				hidden: true,
				access: SERVER_ONLY,
			},
			{
				name: "context",
				type: "group",
				access: SERVER_ONLY,
				fields: [
					{ name: "collection", type: "text" },
					{ name: "docId", type: "text" },
					{ name: "global", type: "text" },
					{ name: "locale", type: "text" },
				],
			},
			{
				name: "kind",
				type: "select",
				options: ["chat", "reactive", "ambient"],
				access: SERVER_ONLY,
			},
			{
				name: "onBehalfOf",
				type: "relationship",
				relationTo: userCollection,
				access: SERVER_ONLY,
			},
			{
				name: "status",
				type: "select",
				options: ["idle", "running", "failed", "archived"],
				defaultValue: "idle",
			},
			{
				name: "lastMessageAt",
				type: "date",
				index: true,
				access: SERVER_ONLY,
			},
			{ name: "lastReadAt", type: "date" },
			{
				name: "lastSubmissionId",
				type: "text",
				admin: { hidden: true },
				access: SERVER_ONLY,
			},
			{
				name: "flueUid",
				type: "text",
				admin: { hidden: true },
				access: SERVER_ONLY,
			},
			{
				name: "dispatchJob",
				type: "text",
				unique: true,
				admin: { hidden: true },
				access: SERVER_ONLY,
			},
		],
	};
};
