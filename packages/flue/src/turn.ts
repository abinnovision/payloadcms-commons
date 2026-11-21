import { randomBytes } from "node:crypto";
import { APIError, createPayloadRequest } from "payload";

import { pendingWhere, serveFile } from "./files/collection.js";
import { ensureAgentKey } from "./keys/manager.js";
import {
	bytesToText,
	isTextMimeType,
	textToBase64,
} from "./protocol/attachments.js";
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

import type { FileDoc } from "./files/collection.js";
import type { KeySettings } from "./keys/manager.js";
import type { NormalizedFiles, NormalizedOptions } from "./options.js";
import type { DeliveredAttachment } from "./protocol/attachments.js";
import type { ChatContext, RunKind } from "./protocol/context.js";
import type { ThreadStatus } from "./protocol/events.js";
import type { FlueInitialData } from "./protocol/exchange.js";
import type { WorkspaceFileRef } from "./protocol/files.js";
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
	/** Ids of the user's pending workspace files the turn claims. */
	files?: DefaultDocumentIDType[] | undefined;
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
	names: (null | string | undefined)[],
): string => {
	const text = message.trim();
	const title = text === "" ? (names[0]?.trim() ?? "") : text;

	return title.slice(0, TITLE_MAX);
};

/*
 * The turn as Flue takes it: a context signal whose body is the preamble,
 * the file references and the message; a `user` message with the context in
 * a preamble when it carries attachments, which only `user` messages can.
 * The body always starts with the preamble, so text the user types cannot
 * pass for one. Flue takes no text documents, so text files go into the
 * body.
 */
const turnMessage = (
	context: ChatContext,
	message: string,
	attachments: DeliveredAttachment[],
	references: WorkspaceFileRef[],
	inline: DeliveredAttachment[],
): Pick<SendArgs, "message" | "timeoutMs"> =>
	attachments.length > 0
		? {
				message: {
					kind: "user",
					body: userTurnBody(
						context,
						message,
						attachments.filter((file) => isTextMimeType(file.mimeType)),
					),
					attachments: attachments.filter(
						(file) => !isTextMimeType(file.mimeType),
					),
				},
				timeoutMs: ATTACHMENT_SEND_MS,
			}
		: {
				message: {
					kind: "signal",
					type: CONTEXT_SIGNAL_TYPE,
					body: userTurnBody(context, message, inline, references),
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

const NO_FILE = "A file does not exist or was sent already.";

/*
 * The text of the claimed text files that fit within `budget` bytes
 * together, read through the collection's file endpoint as the user. A file
 * that cannot be read stays a reference only.
 */
const inlineTexts = async (
	payload: Payload,
	user: TurnUser,
	slug: string,
	docs: FileDoc[],
	budget: number,
): Promise<DeliveredAttachment[]> => {
	const inline: DeliveredAttachment[] = [];
	let left = budget;

	for (const doc of docs) {
		const size = doc.filesize ?? Number.POSITIVE_INFINITY;
		const { mimeType } = doc;

		if (!mimeType || !isTextMimeType(mimeType) || size > left) {
			continue;
		}

		let text: string | undefined;

		try {
			// eslint-disable-next-line no-await-in-loop
			const req = await createPayloadRequest({ payload, user });
			// eslint-disable-next-line no-await-in-loop
			const response = await serveFile(req, slug, doc);

			text =
				response?.ok === true
					? // eslint-disable-next-line no-await-in-loop
						bytesToText(new Uint8Array(await response.arrayBuffer()))
					: undefined;
		} catch (error) {
			payload.logger.warn({
				err: error,
				msg: "[payloadcms-flue] Could not read a text file to inline; it stays a reference.",
			});
		}

		if (text !== undefined) {
			left -= size;
			inline.push({
				type: "document",
				data: textToBase64(text),
				mimeType,
				...(doc.name ? { filename: doc.name } : {}),
			});
		}
	}

	return inline;
};

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

// A thread of the request's user and `agent` that is not archived, or the refusal.
const ownThread = async (
	internal: PayloadRequest,
	settings: PluginSettings,
	id: DefaultDocumentIDType,
	agent: string,
): Promise<ThreadDoc> => {
	const existing = await findThread(internal.payload, settings, id, internal);

	if (
		!existing ||
		existing.agent !== agent ||
		!isOwner(existing.createdBy, internal.user, settings.mcpx.userCollection)
	) {
		throw refuse("The thread does not exist.", 404);
	}

	if (existing.status === "archived") {
		throw refuse("The thread is archived.", 409);
	}

	return existing;
};

/*
 * The workspace files of a turn, read as the user, or the refusal: each id
 * must name one of the user's pending files. Runs before the turn writes
 * anything.
 */
const loadPending = async (
	internal: PayloadRequest,
	files: false | NormalizedFiles,
	ids: DefaultDocumentIDType[] = [],
): Promise<FileDoc[]> => {
	if (ids.length === 0) {
		return [];
	}

	if (!files) {
		throw refuse("files are not enabled.", 400);
	}

	const { docs } = await internal.payload.find({
		collection: files.slug,
		where: { id: { in: ids } },
		depth: 0,
		pagination: false,
		overrideAccess: false,
		select: { name: true, thread: true },
		req: internal,
	});

	if (
		docs.length !== new Set(ids.map(String)).size ||
		docs.some((doc) => doc["thread"] !== null && doc["thread"] !== undefined)
	) {
		throw refuse(NO_FILE, 404);
	}

	return docs as FileDoc[];
};

// Refuses a turn whose files would take the thread past its file cap.
const assertThreadRoom = async (
	internal: PayloadRequest,
	files: false | NormalizedFiles,
	thread: DefaultDocumentIDType,
	adding: number,
): Promise<void> => {
	if (!files || adding === 0) {
		return;
	}

	const { totalDocs } = await internal.payload.count({
		collection: files.slug,
		where: { thread: { equals: thread } },
		overrideAccess: true,
		req: internal,
	});

	if (totalDocs + adding > files.maxFilesPerThread) {
		throw refuse(
			`A thread holds at most ${String(files.maxFilesPerThread)} files.`,
			400,
		);
	}
};

/*
 * Claims the user's pending files for the thread and answers the ones the
 * thread now holds, in the order of `ids`. The update is not atomic across
 * rows, so the thread is read back and only what it holds is referenced.
 */
const claimFiles = async (
	internal: PayloadRequest,
	settings: Pick<PluginSettings, "mcpx"> & { files: NormalizedFiles },
	ids: DefaultDocumentIDType[],
	thread: DefaultDocumentIDType,
): Promise<FileDoc[]> => {
	const { payload } = internal;
	const slug = settings.files.slug;
	const pending = pendingWhere(internal, settings.mcpx.userCollection);

	if (!pending) {
		return [];
	}

	await payload.update({
		collection: slug,
		where: { and: [{ id: { in: ids } }, pending] },
		data: { thread },
		depth: 0,
		overrideAccess: true,
		req: internal,
	});

	const { docs } = await payload.find({
		collection: slug,
		where: {
			and: [{ id: { in: ids } }, { thread: { equals: thread } }],
		},
		depth: 0,
		pagination: false,
		overrideAccess: true,
		select: {
			name: true,
			filename: true,
			prefix: true,
			mimeType: true,
			filesize: true,
		},
		req: internal,
	});
	const order = ids.map(String);

	return (docs as FileDoc[]).sort(
		(a, b) => order.indexOf(String(a.id)) - order.indexOf(String(b.id)),
	);
};

interface TurnFiles {
	references: WorkspaceFileRef[];
	inline: DeliveredAttachment[];
}

/*
 * Claims the turn's files for the thread and answers what its body carries:
 * a reference per claimed file, and the text of the text files that fit
 * within `inlineTextBytes`. Logs files another turn claimed first.
 */
const claimTurnFiles = async (
	internal: PayloadRequest,
	settings: PluginSettings,
	args: Pick<TurnArgs, "files" | "message" | "user"> & {
		thread: DefaultDocumentIDType;
	},
): Promise<TurnFiles> => {
	const { files } = settings;
	const ids = args.files ?? [];

	if (!files || ids.length === 0) {
		return { references: [], inline: [] };
	}

	const { payload } = internal;
	const docs = await claimFiles(
		internal,
		{ ...settings, files },
		ids,
		args.thread,
	);

	if (docs.length < ids.length) {
		payload.logger.warn(
			`[payloadcms-flue] A turn claimed ${String(docs.length)} of its ${String(ids.length)} files; another turn claimed the others.`,
		);
	}

	// Nothing left to send: the turn is refused before it reaches Flue.
	if (docs.length === 0 && args.message.trim() === "") {
		throw refuse(NO_FILE, 404);
	}

	return {
		references: docs.flatMap((doc): WorkspaceFileRef[] =>
			doc.mimeType
				? [
						{
							id: String(doc.id),
							name: doc.name ?? "",
							mimeType: doc.mimeType,
							size: doc.filesize ?? 0,
						},
					]
				: [],
		),
		inline:
			files.inlineTextBytes > 0
				? await inlineTexts(
						payload,
						{ ...args.user, collection: settings.mcpx.userCollection },
						files.slug,
						docs,
						files.inlineTextBytes,
					)
				: [],
	};
};

// Returns the files of a thread Flue never created to their user's pending files.
const releaseFiles = async (
	internal: PayloadRequest,
	files: false | NormalizedFiles,
	thread: DefaultDocumentIDType,
): Promise<void> => {
	if (!files) {
		return;
	}

	await internal.payload.update({
		collection: files.slug,
		where: { thread: { equals: thread } },
		data: { thread: null },
		depth: 0,
		overrideAccess: true,
		req: internal,
	});
};

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

	const pendingFiles = await loadPending(internal, settings.files, args.files);

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
				title: titleOf(args.message, [
					...attachments.map((file) => file.filename),
					...pendingFiles.map((file) => file.name),
				]),
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
		const existing = await ownThread(
			internal,
			settings,
			args.threadId,
			agent.slug,
		);

		await assertThreadRoom(
			internal,
			settings.files,
			existing.id,
			pendingFiles.length,
		);
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

	// Undoes a first turn Flue never took: its files go back to pending.
	const discard = async (): Promise<void> => {
		await releaseFiles(internal, settings.files, thread.id);
		await payload.delete({
			collection,
			id: thread.id,
			overrideAccess: true,
			req: internal,
		});
	};

	let sent = false;

	try {
		// Before the claim, so a failed key write leaves the files pending.
		if (handle === undefined) {
			await ensureKey();
		}

		const { references, inline } = await claimTurnFiles(internal, settings, {
			...args,
			thread: thread.id,
		});
		const context = defined({
			...args.context,
			kind,
			onBehalfOf: onBehalfOf === undefined ? undefined : String(onBehalfOf),
		});
		const submission = await client.send(agent.slug, conversationId, {
			...turnMessage(context, args.message, attachments, references, inline),
			uid: handle === undefined ? flueUid : null,
			initialData:
				handle === undefined
					? undefined
					: { [INITIAL_DATA_KEY]: { handle } satisfies FlueInitialData },
		});

		sent = true;

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
			if (!sent && handle !== undefined) {
				await discard();
			}

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
			await discard();
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
