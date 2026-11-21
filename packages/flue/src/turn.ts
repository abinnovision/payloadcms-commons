import { randomBytes } from "node:crypto";
import { APIError, createPayloadRequest } from "payload";

import { FILE_THREAD_FIELD, serveFile } from "./files/collection.js";
import { ensureAgentKey } from "./keys/manager.js";
import {
	ATTACH_BYTES_PER_TURN,
	ATTACHMENT_MAX_BYTES,
	attachmentKind,
	bytesToBase64,
	isAttachmentMimeType,
} from "./protocol/attachments.js";
import { readCapped } from "./protocol/body.js";
import {
	CONTEXT_SIGNAL_TYPE,
	encodeContext,
	TURN_ATTRIBUTE,
	USER_TURN,
	userTurnBody,
} from "./protocol/context.js";
import { INITIAL_DATA_KEY } from "./protocol/exchange.js";
import { fileAttributes, refName } from "./protocol/files.js";
import { isOwner } from "./protocol/owner.js";
import { createSidecarClient, SidecarError } from "./sidecar/client.js";
import { handleHash } from "./threads/handle.js";
import { ownerWhere } from "./threads/owner.js";

import type { FileDoc } from "./files/collection.js";
import type { KeySettings } from "./keys/manager.js";
import type { NormalizedFiles, NormalizedOptions } from "./options.js";
import type { DeliveredAttachment } from "./protocol/attachments.js";
import type { ChatContext, RunKind } from "./protocol/context.js";
import type { ThreadStatus } from "./protocol/events.js";
import type { FlueInitialData } from "./protocol/exchange.js";
import type { FileRef } from "./protocol/files.js";
import type { RelationValue } from "./protocol/owner.js";
import type { SendArgs } from "./sidecar/client.js";
import type { FlueAgentConfig, FlueRequestContext } from "./types.js";
import type {
	DefaultDocumentIDType,
	Payload,
	PayloadRequest,
	Where,
} from "payload";

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
	/** Ids of the user's files the turn binds to the thread and sends. */
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
 * The turn as Flue takes it: a context signal whose body is the message, or
 * a `user` message with the context in a preamble when it carries
 * attachments, which only `user` messages can. The body of a `user` message
 * always starts with the preamble, so text the user types cannot pass for
 * one. The files go into attributes in both shapes.
 */
const turnMessage = (
	context: ChatContext,
	message: string,
	files: Record<string, string>,
	attachments: DeliveredAttachment[],
): Pick<SendArgs, "message" | "timeoutMs"> =>
	attachments.length > 0
		? {
				message: {
					kind: "user",
					body: userTurnBody(context, message, files),
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
						...files,
					},
				},
			};

const refuse = (message: string, status: number): APIError =>
	new APIError(message, status, null, true);

const GONE =
	"The agent sidecar no longer has this conversation. Start a new thread.";

const NO_FILE = "A file does not exist or belongs to another thread.";

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

// The user's files among `ids`, or `false` outside the mcpx user collection.
const ownFiles = (
	internal: PayloadRequest,
	settings: Pick<NormalizedOptions, "mcpx">,
	ids: DefaultDocumentIDType[],
	thread: DefaultDocumentIDType | undefined,
): false | Where => {
	const owned = ownerWhere(internal, settings.mcpx.userCollection);

	return (
		owned && {
			and: [
				{ id: { in: ids } },
				owned,
				thread === undefined
					? { [FILE_THREAD_FIELD]: { exists: false } }
					: {
							or: [
								{ [FILE_THREAD_FIELD]: { exists: false } },
								{ [FILE_THREAD_FIELD]: { equals: thread } },
							],
						},
			],
		}
	);
};

// The files in the order of `ids`.
const inOrder = (docs: FileDoc[], ids: DefaultDocumentIDType[]): FileDoc[] => {
	const order = ids.map(String);

	return docs.sort(
		(a, b) => order.indexOf(String(a.id)) - order.indexOf(String(b.id)),
	);
};

/*
 * Refuses a turn unless each id names a file the user created that is
 * unbound or bound to `thread` already, read as the user. Runs before the
 * turn writes anything; answers the files' names for a new thread's title.
 */
const checkFiles = async (
	internal: PayloadRequest,
	settings: Pick<NormalizedOptions, "files" | "mcpx">,
	ids: DefaultDocumentIDType[],
	thread: DefaultDocumentIDType | undefined,
): Promise<FileDoc[]> => {
	if (ids.length === 0) {
		return [];
	}

	const where = settings.files && ownFiles(internal, settings, ids, thread);

	if (!settings.files || !where) {
		throw refuse(NO_FILE, 404);
	}

	const { docs } = await internal.payload.find({
		collection: settings.files.collection,
		where,
		depth: 0,
		pagination: false,
		overrideAccess: false,
		req: internal,
	});

	if (docs.length !== new Set(ids.map(String)).size) {
		throw refuse(NO_FILE, 404);
	}

	return inOrder(docs, ids);
};

/*
 * Binds the user's unbound files among `ids` to the thread and answers the
 * ones it holds, in the order of `ids`. Each row is claimed with one
 * conditional write, so of two turns binding the same file only one wins;
 * `checkFiles` already proved the user created them, which nobody can
 * change. A claimed row is then updated through Payload, so versions and
 * hooks see the binding.
 */
const bindFiles = async (
	internal: PayloadRequest,
	settings: Pick<NormalizedOptions, "mcpx"> & { files: NormalizedFiles },
	ids: DefaultDocumentIDType[],
	thread: DefaultDocumentIDType,
): Promise<FileDoc[]> => {
	const { payload } = internal;
	const { collection } = settings.files;
	const owned = ownerWhere(internal, settings.mcpx.userCollection);

	if (!owned) {
		return [];
	}

	for (const id of ids) {
		// eslint-disable-next-line no-await-in-loop
		const claimed: unknown = await payload.db.updateOne({
			collection,
			where: {
				and: [
					{ id: { equals: id } },
					{ [FILE_THREAD_FIELD]: { exists: false } },
				],
			},
			data: { [FILE_THREAD_FIELD]: thread },
			options: { atomic: true },
			req: internal,
		});

		if (claimed) {
			// eslint-disable-next-line no-await-in-loop
			await payload.update({
				collection,
				id,
				data: { [FILE_THREAD_FIELD]: thread },
				depth: 0,
				overrideAccess: true,
				req: internal,
			});
		}
	}

	const { docs } = await payload.find({
		collection,
		where: {
			and: [
				{ id: { in: ids } },
				owned,
				{ [FILE_THREAD_FIELD]: { equals: thread } },
			],
		},
		depth: 0,
		pagination: false,
		overrideAccess: true,
		req: internal,
	});

	return inOrder(docs, ids);
};

// The uploader's name where the collection keeps one, else the stored name.
const nameOf = (doc: FileDoc): string =>
	typeof doc.name === "string" && doc.name !== ""
		? doc.name
		: (doc.filename ?? "");

/*
 * The bytes of a file, read as the user and cancelled past `maxBytes`, or
 * `undefined`.
 */
const readAsUser = async (
	payload: Payload,
	user: TurnUser,
	collection: string,
	doc: FileDoc,
	maxBytes: number,
): Promise<Uint8Array | undefined> => {
	try {
		const req = await createPayloadRequest({ payload, user });
		const response = await serveFile(req, collection, doc);

		if (response?.ok !== true) {
			await response?.body?.cancel().catch(() => undefined);

			return undefined;
		}

		return await readCapped(response, maxBytes);
	} catch (error) {
		payload.logger.warn({
			err: error,
			msg: "[payloadcms-flue] Could not read a file to attach; it is referenced only.",
		});

		return undefined;
	}
};

interface TurnFiles {
	attributes: Record<string, string>;
	attachments: DeliveredAttachment[];
}

/*
 * Binds the turn's files to the thread and answers what the turn carries:
 * every file as a reference, and the ones the policy attaches that Flue
 * takes natively, within its cap and the per-turn budget, as attachments.
 * Logs files another turn bound first.
 */
const deliverFiles = async (
	internal: PayloadRequest,
	settings: PluginSettings,
	args: Pick<TurnArgs, "agent" | "files" | "message" | "user"> & {
		thread: DefaultDocumentIDType;
	},
): Promise<TurnFiles> => {
	const { files } = settings;
	const ids = args.files ?? [];

	if (!files || ids.length === 0) {
		return { attributes: {}, attachments: [] };
	}

	const { payload } = internal;
	const docs = await bindFiles(
		internal,
		{ ...settings, files },
		ids,
		args.thread,
	);

	if (docs.length < ids.length) {
		payload.logger.warn(
			`[payloadcms-flue] A turn bound ${String(docs.length)} of its ${String(ids.length)} files; another turn bound the others.`,
		);
	}

	// Nothing left to send: the turn is refused before it reaches Flue.
	if (docs.length === 0 && args.message.trim() === "") {
		throw refuse(NO_FILE, 404);
	}

	const deliver =
		typeof args.agent.files === "object" && args.agent.files.deliver
			? args.agent.files.deliver
			: files.deliver;
	const user = { ...args.user, collection: settings.mcpx.userCollection };
	const refs: Omit<FileRef, "collection">[] = [];
	const attachments: DeliveredAttachment[] = [];
	let budget = ATTACH_BYTES_PER_TURN;

	for (const doc of docs) {
		const mimeType = doc.mimeType ?? "";
		const size = doc.filesize ?? Number.POSITIVE_INFINITY;
		const name = nameOf(doc);
		const cap = Math.min(ATTACHMENT_MAX_BYTES, budget);
		const bytes =
			isAttachmentMimeType(mimeType) &&
			size <= cap &&
			deliver({ mimeType, size, agent: args.agent.slug }) === "attach"
				? // eslint-disable-next-line no-await-in-loop
					await readAsUser(payload, user, files.collection, doc, cap)
				: undefined;
		const filename = refName(name);

		if (bytes !== undefined && isAttachmentMimeType(mimeType)) {
			budget -= bytes.byteLength;
			attachments.push({
				type: attachmentKind(mimeType),
				data: bytesToBase64(bytes),
				mimeType,
				...(filename === "" ? {} : { filename }),
			});
		}

		refs.push({
			id: String(doc.id),
			name,
			mimeType,
			size: doc.filesize ?? 0,
			attached: bytes !== undefined,
		});
	}

	return {
		attributes: fileAttributes(files.collection, refs),
		attachments,
	};
};

// Unbinds the files of a thread Flue never created, so they may be sent again.
const unbindFiles = async (
	internal: PayloadRequest,
	files: false | NormalizedFiles,
	thread: DefaultDocumentIDType,
): Promise<void> => {
	if (!files) {
		return;
	}

	await internal.payload.update({
		collection: files.collection,
		where: { [FILE_THREAD_FIELD]: { equals: thread } },
		data: { [FILE_THREAD_FIELD]: null },
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
	const fileIds = args.files ?? [];
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
		const files = await checkFiles(internal, settings, fileIds, undefined);

		// Before the row, so a failed key write leaves no thread behind.
		await ensureKey();
		handle = randomToken();
		thread = (await payload.create({
			collection,
			data: {
				agent: agent.slug,
				conversationId: randomToken(),
				handleHash: handleHash(handle),
				title: titleOf(
					args.message,
					files.map((file) => nameOf(file)),
				),
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

		await checkFiles(internal, settings, fileIds, existing.id);
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

	// Undoes a first turn Flue never took, unbinding its files first.
	const discard = async (): Promise<void> => {
		try {
			await unbindFiles(internal, settings.files, thread.id);
		} catch (error) {
			payload.logger.error({
				err: error,
				msg: "[payloadcms-flue] Could not unbind the files of a discarded thread.",
			});
		}

		await payload.delete({
			collection,
			id: thread.id,
			overrideAccess: true,
			req: internal,
		});
	};

	let sent = false;

	try {
		// Before the binding, so a failed key write leaves the files unbound.
		if (handle === undefined) {
			await ensureKey();
		}

		const { attributes, attachments } = await deliverFiles(internal, settings, {
			...args,
			thread: thread.id,
		});
		const context = defined({
			...args.context,
			kind,
			onBehalfOf: onBehalfOf === undefined ? undefined : String(onBehalfOf),
		});
		const submission = await client.send(agent.slug, conversationId, {
			...turnMessage(context, args.message, attributes, attachments),
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
