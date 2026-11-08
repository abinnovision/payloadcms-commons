import { agentAdmits } from "./agents.js";
import {
	endpointHandler,
	isDocumentId,
	json,
	readJson,
	refusal,
	requireJson,
	requireUser,
} from "./http.js";
import { CHAT_BODY_MAX } from "../options.js";
import { attachmentKind } from "../protocol/attachments.js";
import { isRecord } from "../protocol/guards.js";
import { routePath } from "../protocol/paths.js";
import { startTurn } from "../turn.js";

import type { NormalizedAttachments } from "../options.js";
import type {
	AttachmentMimeType,
	DeliveredAttachment,
} from "../protocol/attachments.js";
import type { PluginSettings, TurnContext } from "../turn.js";
import type { PayloadHandler, PayloadRequest } from "payload";

const MESSAGE_MAX = 16_000;
const FILENAME_MAX = 255;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

type SendContext = Pick<
	TurnContext,
	"collection" | "global" | "id" | "locale" | "route"
>;

interface ChatBody {
	message: string;
	attachments: DeliveredAttachment[];
	thread?: number | string | undefined;
	context: SendContext;
}

const optionalString = (value: unknown): string | undefined | false => {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (typeof value === "number") {
		return String(value);
	}

	return typeof value === "string" ? value : false;
};

// The decoded size of valid base64.
const decodedSize = (data: string): number =>
	(data.length / 4) * 3 -
	(data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

// The leading bytes of each type, by offset, as latin1 text.
const SIGNATURES: Record<
	AttachmentMimeType,
	ReadonlyArray<readonly [number, string]>
> = {
	"image/png": [[0, "\x89PNG"]],
	"image/jpeg": [[0, "\xff\xd8\xff"]],
	"image/gif": [[0, "GIF8"]],
	"image/webp": [
		[0, "RIFF"],
		[8, "WEBP"],
	],
	"application/pdf": [[0, "%PDF-"]],
};

// Whether the base64 bytes start like a file of the type.
const hasSignature = (data: string, mimeType: AttachmentMimeType): boolean => {
	const head = Buffer.from(data.slice(0, 16), "base64").toString("latin1");

	return SIGNATURES[mimeType].every(([offset, signature]) =>
		head.startsWith(signature, offset),
	);
};

// The attachments, or the reason they are refused.
const parseAttachments = (
	value: unknown,
	limits: false | NormalizedAttachments,
): DeliveredAttachment[] | string => {
	if (value === undefined) {
		return [];
	}

	if (!limits) {
		return "attachments are not enabled.";
	}

	if (!Array.isArray(value) || value.length > limits.maxFiles) {
		return `attachments must be a list of at most ${String(limits.maxFiles)} files.`;
	}

	const attachments: DeliveredAttachment[] = [];

	for (const [index, item] of (value as unknown[]).entries()) {
		const at = `attachments[${String(index)}]`;

		if (!isRecord(item)) {
			return `${at} must be an object.`;
		}

		const { type, mimeType, data, filename } = item;

		if (
			typeof mimeType !== "string" ||
			!(limits.mimeTypes as string[]).includes(mimeType)
		) {
			return `${at}.mimeType must be one of ${limits.mimeTypes.join(", ")}.`;
		}

		const kind = attachmentKind(mimeType as AttachmentMimeType);

		if (type !== kind) {
			return `${at}.type must be "${kind}" for ${mimeType}.`;
		}

		const max =
			kind === "image" ? limits.maxImageBytes : limits.maxDocumentBytes;

		if (
			typeof data !== "string" ||
			data.length % 4 !== 0 ||
			!BASE64.test(data) ||
			decodedSize(data) > max
		) {
			return `${at}.data must be base64 of at most ${String(max)} bytes.`;
		}

		if (!hasSignature(data, mimeType as AttachmentMimeType)) {
			return `${at}.data is not a ${mimeType} file.`;
		}

		if (
			filename !== undefined &&
			(typeof filename !== "string" || filename.length > FILENAME_MAX)
		) {
			return `${at}.filename must be a string of at most ${String(FILENAME_MAX)} characters.`;
		}

		attachments.push({
			type: kind,
			data,
			mimeType: mimeType as AttachmentMimeType,
			...(filename === undefined ? {} : { filename }),
		});
	}

	return attachments;
};

// The message, or the reason it is refused. A turn with files may come without text.
const parseMessage = (
	message: unknown,
	hasFiles: boolean,
): { text: string } | string => {
	const min = hasFiles ? 0 : 1;

	return typeof message === "string" &&
		message.trim().length >= min &&
		message.length <= MESSAGE_MAX
		? { text: message }
		: `message must be a string of ${String(min)} to ${String(MESSAGE_MAX)} characters.`;
};

// The body, or the reason it is refused.
const parseBody = (
	req: PayloadRequest,
	body: unknown,
	limits: false | NormalizedAttachments,
): ChatBody | string => {
	if (!isRecord(body)) {
		return "The body must be a JSON object.";
	}

	const { message, thread, context } = body;
	const attachments = parseAttachments(body["attachments"], limits);

	if (typeof attachments === "string") {
		return attachments;
	}

	const parsed = parseMessage(message, attachments.length > 0);

	if (typeof parsed === "string") {
		return parsed;
	}

	if (
		thread !== undefined &&
		thread !== null &&
		!(
			(typeof thread === "string" || typeof thread === "number") &&
			isDocumentId(req, String(thread))
		)
	) {
		return "thread must be a thread id.";
	}

	if (!isRecord(context) || typeof context["route"] !== "string") {
		return "context must name the admin route.";
	}

	const { config, collections } = req.payload;
	const collection = optionalString(context["collection"]);
	const id = optionalString(context["id"]);
	const global = optionalString(context["global"]);
	const locale = optionalString(context["locale"]);

	if (
		collection === false ||
		(collection !== undefined && !Object.hasOwn(collections, collection))
	) {
		return "context.collection must name a collection.";
	}

	if (id === false) {
		return "context.id must be a document id.";
	}

	if (
		global === false ||
		(global !== undefined &&
			!config.globals.some((candidate) => candidate.slug === global))
	) {
		return "context.global must name a global.";
	}

	if (
		locale === false ||
		(locale !== undefined &&
			!(
				config.localization && config.localization.localeCodes.includes(locale)
			))
	) {
		return "context.locale must name a locale.";
	}

	return {
		message: parsed.text,
		attachments,
		thread: thread ?? undefined,
		context: { route: context["route"], collection, id, global, locale },
	};
};

/*
 * When the open document was last saved, as the user can read it; a
 * document the user cannot read leaves it out.
 */
const updatedAtOf = async (
	req: PayloadRequest,
	context: SendContext,
): Promise<string | undefined> => {
	const args = {
		depth: 0,
		draft: true,
		overrideAccess: false,
		select: { updatedAt: true },
		req,
	} as const;
	let doc: null | Record<string, unknown> = null;

	try {
		if (context.collection !== undefined && context.id !== undefined) {
			doc = await req.payload.findByID({
				...args,
				collection: context.collection,
				id: context.id,
				disableErrors: true,
			});
		} else if (context.global !== undefined) {
			doc = await req.payload.findGlobal({ ...args, slug: context.global });
		}
	} catch {
		return undefined;
	}

	return typeof doc?.["updatedAt"] === "string" ? doc["updatedAt"] : undefined;
};

/**
 * `POST {base}/chat/:agent`: sends the signed-in user's message to the
 * agent, in a new thread or one of theirs, and answers the thread's
 * conversation route and where its updates start.
 */
export const chatHandler = (settings: PluginSettings): PayloadHandler =>
	endpointHandler(async (req) => {
		const user = requireUser(req, settings.mcpx.userCollection);

		if (user instanceof Response) {
			return user;
		}

		const agent = settings.agents.find(
			(candidate) => candidate.slug === req.routeParams?.["agent"],
		);

		if (!agent) {
			return refusal(404, "The agent does not exist.");
		}

		if (!(await agentAdmits(agent, req))) {
			return refusal(403, "This user cannot chat with the agent.");
		}

		const notJson = requireJson(req);

		if (notJson) {
			return notJson;
		}

		const raw = await readJson(
			req,
			settings.attachments ? settings.attachments.bodyMax : CHAT_BODY_MAX,
		);

		if (raw instanceof Response) {
			return raw;
		}

		const body = parseBody(req, raw, settings.attachments);

		if (typeof body === "string") {
			return refusal(400, body);
		}

		const { thread, offset, submissionId } = await startTurn(req, settings, {
			agent,
			user,
			threadId: body.thread,
			message: body.message,
			attachments: body.attachments,
			context: {
				...body.context,
				updatedAt: await updatedAtOf(req, body.context),
			},
			kind: "chat",
		});

		return json(200, {
			thread: { id: thread.id, title: thread.title, status: thread.status },
			offset,
			submissionId,
			streamUrl: `${req.payload.config.routes.api}${settings.endpointPath}${routePath("conversation", { thread: thread.id })}`,
		});
	});
