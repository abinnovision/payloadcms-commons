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
import { isRefId } from "../protocol/files.js";
import { isRecord } from "../protocol/guards.js";
import { routePath } from "../protocol/paths.js";
import { startTurn } from "../turn.js";

import type { NormalizedFiles } from "../options.js";
import type { PluginSettings, TurnContext } from "../turn.js";
import type { PayloadHandler, PayloadRequest } from "payload";

const MESSAGE_MAX = 16_000;
const FOCUS_MAX = 256;
const FOCUS_PATH = /^[\w.-]+$/;

type SendContext = Pick<
	TurnContext,
	"collection" | "focus" | "global" | "id" | "locale" | "route"
>;

interface ChatBody {
	message: string;
	/** Ids of the user's files in the files collection. */
	files: string[];
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

// The path of the focused field, or false when it is not one.
const parseFocus = (value: unknown): string | undefined | false => {
	const focus = optionalString(value);

	return typeof focus === "string" &&
		(focus.length > FOCUS_MAX || !FOCUS_PATH.test(focus))
		? false
		: focus;
};

// The ids of the turn's files, or the reason they are refused.
const parseFiles = (
	req: PayloadRequest,
	value: unknown,
	files: false | NormalizedFiles,
): string | string[] => {
	if (value === undefined) {
		return [];
	}

	if (!files) {
		return "This agent takes no files.";
	}

	const ids = Array.isArray(value)
		? (value as unknown[]).map((id) =>
				typeof id === "number" ? String(id) : id,
			)
		: [];

	if (
		!Array.isArray(value) ||
		ids.length > files.maxFilesPerTurn ||
		!ids.every((id): id is string => isDocumentId(req, id) && isRefId(id)) ||
		new Set(ids).size !== ids.length
	) {
		return `files must be a list of at most ${String(files.maxFilesPerTurn)} distinct file ids.`;
	}

	return ids;
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
	fileLimits: false | NormalizedFiles,
): ChatBody | string => {
	if (!isRecord(body)) {
		return "The body must be a JSON object.";
	}

	const { message, thread, context } = body;
	const files = parseFiles(req, body["files"], fileLimits);

	if (typeof files === "string") {
		return files;
	}

	const parsed = parseMessage(message, files.length > 0);

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
	const focus = parseFocus(context["focus"]);

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

	if (focus === false) {
		return `context.focus must be a field path of at most ${String(FOCUS_MAX)} characters.`;
	}

	return {
		message: parsed.text,
		files,
		thread: thread ?? undefined,
		context: { route: context["route"], collection, id, global, locale, focus },
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

// Whether the open document or global has drafts; undefined without one open.
const draftsOf = (
	req: PayloadRequest,
	context: SendContext,
): boolean | undefined => {
	if (context.collection !== undefined && context.id !== undefined) {
		return Boolean(
			req.payload.collections[context.collection]?.config.versions?.drafts,
		);
	}

	if (context.global !== undefined) {
		return Boolean(
			req.payload.config.globals.find(
				(candidate) => candidate.slug === context.global,
			)?.versions?.drafts,
		);
	}

	return undefined;
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

		const raw = await readJson(req, CHAT_BODY_MAX);

		if (raw instanceof Response) {
			return raw;
		}

		const body = parseBody(req, raw, agent.files ? settings.files : false);

		if (typeof body === "string") {
			return refusal(400, body);
		}

		const { thread, offset, submissionId } = await startTurn(req, settings, {
			agent,
			user,
			threadId: body.thread,
			message: body.message,
			files: body.files,
			context: {
				...body.context,
				updatedAt: await updatedAtOf(req, body.context),
				drafts: draftsOf(req, body.context),
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
