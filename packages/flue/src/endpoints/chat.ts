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
import { isRecord } from "../protocol/guards.js";
import { routePath } from "../protocol/paths.js";
import { startTurn } from "../turn.js";

import type { PluginSettings, TurnContext } from "../turn.js";
import type { PayloadHandler, PayloadRequest } from "payload";

const BODY_MAX = 64 * 1024;
const MESSAGE_MAX = 16_000;

type SendContext = Pick<
	TurnContext,
	"collection" | "global" | "id" | "locale" | "route"
>;

interface ChatBody {
	message: string;
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

// The body, or the reason it is refused.
const parseBody = (req: PayloadRequest, body: unknown): ChatBody | string => {
	if (!isRecord(body)) {
		return "The body must be a JSON object.";
	}

	const { message, thread, context } = body;

	if (
		typeof message !== "string" ||
		message.trim() === "" ||
		message.length > MESSAGE_MAX
	) {
		return `message must be a string of 1 to ${String(MESSAGE_MAX)} characters.`;
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
		message,
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

		const raw = await readJson(req, BODY_MAX);

		if (raw instanceof Response) {
			return raw;
		}

		const body = parseBody(req, raw);

		if (typeof body === "string") {
			return refusal(400, body);
		}

		const { thread, offset, submissionId } = await startTurn(req, settings, {
			agent,
			user,
			threadId: body.thread,
			message: body.message,
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
