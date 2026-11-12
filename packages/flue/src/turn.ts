import { randomBytes } from "node:crypto";
import { APIError, createPayloadRequest } from "payload";

import { ensureAgentKey } from "./keys/manager.js";
import {
	CONTEXT_SIGNAL_TYPE,
	encodeContext,
	TURN_ATTRIBUTE,
	USER_TURN,
	userTurnBody,
} from "./protocol/context.js";
import { INITIAL_DATA_KEY } from "./protocol/exchange.js";
import { isOwner } from "./protocol/owner.js";
import { createSidecarClient, SidecarError } from "./sidecar/client.js";
import { handleHash } from "./threads/handle.js";

import type { KeySettings } from "./keys/manager.js";
import type { NormalizedOptions } from "./options.js";
import type { DeliveredAttachment } from "./protocol/attachments.js";
import type { ChatContext, RunKind } from "./protocol/context.js";
import type { ThreadStatus } from "./protocol/events.js";
import type { FlueInitialData } from "./protocol/exchange.js";
import type { RelationValue } from "./protocol/owner.js";
import type { SendArgs } from "./sidecar/client.js";
import type { FlueAgentConfig, FlueRequestContext } from "./types.js";
import type { DefaultDocumentIDType, Payload, PayloadRequest } from "payload";

/** The plugin's settings plus the capability map keys are written from. */
export type PluginSettings = NormalizedOptions & KeySettings;

/** The user a turn acts as. */
export type TurnUser = NonNullable<PayloadRequest["user"]>;

/** A thread row as the plugin reads it, hidden fields included. */
export interface ThreadDoc {
	id: DefaultDocumentIDType;
	agent: string;
	conversationId?: null | string;
	handleHash?: null | string;
	title?: null | string;
	/** The title the agent last wrote, which a rename by the user leaves as it is. */
	agentTitle?: null | string;
	kind?: null | RunKind;
	status?: null | ThreadStatus;
	createdBy?: null | RelationValue;
	lastSubmissionId?: null | string;
	/** The incarnation of the conversation in Flue that the thread sends to. */
	flueUid?: null | string;
	dispatchJob?: null | string;
}

/** The page a turn starts from. Unset values stay out of the signal. */
export type TurnContext = {
	[K in Exclude<keyof ChatContext, "drafts" | "kind" | "onBehalfOf">]?:
		string | undefined;
} & { drafts?: boolean | undefined };

export interface TurnArgs {
	agent: FlueAgentConfig;
	user: TurnUser;
	/** An existing thread of `user` and `agent`; a new one when left out. */
	threadId?: DefaultDocumentIDType | undefined;
	message: string;
	/** Sends the turn as a Flue `user` message when non-empty. */
	attachments?: DeliveredAttachment[] | undefined;
	context: TurnContext;
	kind: RunKind;
	onBehalfOf?: DefaultDocumentIDType | undefined;
	/** The job a dispatch runs as, which makes the turn idempotent on it. */
	dispatchJob?: string | undefined;
}

export interface TurnResult {
	thread: ThreadDoc;
	/** Where the turn's updates start, if the turn has a submission. */
	offset: string | undefined;
	submissionId: string | undefined;
}

const TITLE_MAX = 80;

// Attachment sends carry large bodies, which Flue may still admit after 10 seconds.
const ATTACHMENT_SEND_MS = 60_000;

const randomToken = (): string => randomBytes(32).toString("base64url");

// Leaves out unset values, which exact optional properties do not accept.
const defined = <T extends object>(
	value: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } =>
	Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as { [K in keyof T]?: Exclude<T[K], undefined> };

// A new thread's title: the text, else the first file's name.
const titleOf = (
	message: string,
	attachments: DeliveredAttachment[],
): string => {
	const text = message.trim();
	const title = text === "" ? (attachments[0]?.filename?.trim() ?? "") : text;

	return title.slice(0, TITLE_MAX);
};

/*
 * The turn as Flue takes it: a context signal, or a `user` message with the
 * context in a preamble when it carries files, which only `user` messages can.
 */
const turnMessage = (
	context: ChatContext,
	message: string,
	attachments: DeliveredAttachment[],
): Pick<SendArgs, "message" | "timeoutMs"> =>
	attachments.length > 0
		? {
				message: {
					kind: "user",
					body: userTurnBody(context, message),
					attachments,
				},
				timeoutMs: ATTACHMENT_SEND_MS,
			}
		: {
				message: {
					kind: "signal",
					type: CONTEXT_SIGNAL_TYPE,
					body: message,
					attributes: {
						...encodeContext(context),
						[TURN_ATTRIBUTE]: USER_TURN,
					},
				},
			};

const refuse = (message: string, status: number): APIError =>
	new APIError(message, status, null, true);

const GONE =
	"The agent sidecar no longer has this conversation. Start a new thread.";

/**
 * A fresh request for the plugin's own writes. Authorship records `user`,
 * and hooks see `req.context.flue` marked internal, which lets the write
 * change what users cannot.
 */
export const internalRequest = (
	payload: Payload,
	user: null | TurnUser,
	flue: Omit<FlueRequestContext, "internal">,
): Promise<PayloadRequest> =>
	createPayloadRequest({
		payload,
		user,
		context: { flue: { ...flue, internal: true } },
	});

/** A thread past access control, hidden fields included, or `null`. */
export const findThread = async (
	payload: Payload,
	settings: Pick<NormalizedOptions, "threads">,
	id: DefaultDocumentIDType,
	req: PayloadRequest,
): Promise<null | ThreadDoc> =>
	(await payload.findByID({
		collection: settings.threads.slug,
		id,
		depth: 0,
		overrideAccess: true,
		showHiddenFields: true,
		disableErrors: true,
		req,
	})) as null | ThreadDoc;

/**
 * Starts one turn: finds or creates the thread, rolls the key, and posts the
 * message as a context signal. A new thread creates its conversation in
 * Flue; a later turn reaches only the incarnation the thread recorded, so a
 * conversation Flue lost is refused, never started again. Never mutates
 * `req`; every write runs on an internal request as `user`.
 */
export const startTurn = async (
	req: PayloadRequest,
	settings: PluginSettings,
	args: TurnArgs,
): Promise<TurnResult> => {
	const { payload } = req;
	const { agent, kind, onBehalfOf, dispatchJob } = args;
	const attachments = args.attachments ?? [];
	const { userCollection } = settings.mcpx;
	const collection = settings.threads.slug;
	const user: TurnUser = { ...args.user, collection: userCollection };
	const client = createSidecarClient(settings.sidecar);
	const flue = {
		agent: agent.slug,
		kind,
		...(onBehalfOf === undefined ? {} : { onBehalfOf }),
	};
	const internal = await internalRequest(payload, user, flue);
	const turnAt = new Date().toISOString();

	const ensureKey = () =>
		ensureAgentKey(payload, settings, {
			userId: user.id,
			agent,
			req: internal,
		});

	let thread: ThreadDoc;
	// Set when this turn creates the conversation in Flue, which reads it once.
	let handle: string | undefined;

	if (args.threadId === undefined) {
		// Before the row, so a failed key write leaves no thread behind.
		await ensureKey();
		handle = randomToken();
		thread = (await payload.create({
			collection,
			data: {
				agent: agent.slug,
				conversationId: randomToken(),
				handleHash: handleHash(handle),
				title: titleOf(args.message, attachments),
				context: {
					collection: args.context.collection,
					docId: args.context.id,
					global: args.context.global,
					locale: args.context.locale,
				},
				kind,
				onBehalfOf,
				dispatchJob,
				lastMessageAt: turnAt,
			},
			depth: 0,
			overrideAccess: true,
			showHiddenFields: true,
			req: internal,
		})) as ThreadDoc;
	} else {
		const existing = await findThread(
			payload,
			settings,
			args.threadId,
			internal,
		);

		if (
			!existing ||
			existing.agent !== agent.slug ||
			!isOwner(existing.createdBy, user, userCollection)
		) {
			throw refuse("The thread does not exist.", 404);
		}

		if (existing.status === "archived") {
			throw refuse("The thread is archived.", 409);
		}

		thread = existing;
	}

	internal.context.flue = { ...flue, thread: thread.id, internal: true };

	const { conversationId, flueUid } = thread;

	if (!conversationId) {
		throw new Error(
			`[payloadcms-flue] Thread ${String(thread.id)} has no conversation.`,
		);
	}

	// Conditional, so a thread archived while the message went out stays archived.
	const updateUnlessArchived = async (
		data: Record<string, unknown>,
	): Promise<null | ThreadDoc> =>
		(await payload.db.updateOne({
			collection,
			where: {
				and: [
					{ id: { equals: thread.id } },
					{ status: { not_equals: "archived" } },
				],
			},
			data,
			options: { atomic: true },
			req: internal,
		})) as null | ThreadDoc;

	// Without a recorded incarnation, no send can reach the conversation.
	if (handle === undefined && !flueUid) {
		await updateUnlessArchived({ status: "failed", lastMessageAt: turnAt });

		throw refuse(GONE, 409);
	}

	try {
		if (handle === undefined) {
			await ensureKey();
		}

		const context = defined({
			...args.context,
			kind,
			onBehalfOf: onBehalfOf === undefined ? undefined : String(onBehalfOf),
		});
		const submission = await client.send(agent.slug, conversationId, {
			...turnMessage(context, args.message, attachments),
			uid: handle === undefined ? flueUid : null,
			initialData:
				handle === undefined
					? undefined
					: { [INITIAL_DATA_KEY]: { handle } satisfies FlueInitialData },
		});

		const running = await updateUnlessArchived({
			status: "running",
			lastMessageAt: turnAt,
			lastSubmissionId: submission.submissionId,
			flueUid: submission.uid,
		});

		if (!running) {
			// A dispatch reports the archived thread; a chat turn is refused.
			if (dispatchJob === undefined) {
				throw refuse("The thread is archived.", 409);
			}

			return { thread, offset: undefined, submissionId: undefined };
		}

		return {
			thread: running,
			offset: submission.offset,
			submissionId: submission.submissionId,
		};
	} catch (error) {
		if (!(error instanceof SidecarError)) {
			throw error;
		}

		payload.logger.error({
			err: error,
			msg: "[payloadcms-flue] The sidecar did not take a turn.",
		});

		if (
			handle !== undefined &&
			error.status !== undefined &&
			error.status < 500
		) {
			// Flue refused the first message at admission and created nothing.
			await payload.delete({
				collection,
				id: thread.id,
				overrideAccess: true,
				req: internal,
			});
		} else {
			/*
			 * Flue may have admitted the message, and its agent may hold the
			 * exchanged key, so the row stays for Stop, Archive and the
			 * exchange.
			 */
			await updateUnlessArchived({ status: "failed", lastMessageAt: turnAt });
		}

		if (
			handle === undefined &&
			error.status === 404 &&
			error.type === "agent_instance_not_found"
		) {
			throw refuse(GONE, 409);
		}

		throw refuse("The agent sidecar did not accept the message.", 502);
	}
};
