/**
 * The Flue signal type that carries the per-turn context. On a user's turn
 * the signal's body is the user's message; agent code reads the context
 * back with {@link decodeContext}.
 */
export const CONTEXT_SIGNAL_TYPE = "payload-context";

/**
 * The attribute that marks the context signal of a user's turn, whose body
 * is the user's message. The chat endpoint sets it when posting, never
 * {@link encodeContext}.
 */
export const TURN_ATTRIBUTE = "turn";

/** The value of {@link TURN_ATTRIBUTE} on a user's turn. */
export const USER_TURN = "user";

/** How a run was started: from the chat panel, a hook or a schedule. */
export type RunKind = "chat" | "reactive" | "ambient";

const RUN_KINDS: readonly string[] = ["chat", "reactive", "ambient"];

/**
 * What the agent learns about the run and the admin page it was started
 * from, once per turn. `updatedAt` is the open document's, so a resumed
 * thread can tell its picture is stale. `drafts` says whether the open
 * document has drafts, `focus` names the field the user last focused.
 */
export interface ChatContext {
	route?: string;
	collection?: string;
	id?: string;
	global?: string;
	locale?: string;
	updatedAt?: string;
	drafts?: boolean;
	focus?: string;
	kind?: RunKind;
	onBehalfOf?: string;
}

const KEYS = [
	"route",
	"collection",
	"id",
	"global",
	"locale",
	"updatedAt",
	"drafts",
	"focus",
	"kind",
	"onBehalfOf",
] as const satisfies readonly (keyof ChatContext)[];

/**
 * The context as Flue signal attributes, leaving out unset values. `drafts`
 * becomes `"true"` or `"false"`.
 */
export const encodeContext = (context: ChatContext): Record<string, string> => {
	const attributes: Record<string, string> = {};

	for (const key of KEYS) {
		const value = context[key];

		if (value !== undefined) {
			attributes[key] = String(value);
		}
	}

	return attributes;
};

/**
 * The context from Flue signal attributes. Attributes it does not know, a
 * `kind` outside {@link RunKind} and a `drafts` other than `"true"` or
 * `"false"` are ignored.
 */
export const decodeContext = (
	attributes: Readonly<Record<string, unknown>>,
): ChatContext => {
	const context: ChatContext = {};

	for (const key of KEYS) {
		const value = attributes[key];

		if (typeof value !== "string") {
			continue;
		}

		if (key === "kind") {
			if (RUN_KINDS.includes(value)) {
				context.kind = value as RunKind;
			}
		} else if (key === "drafts") {
			if (value === "true" || value === "false") {
				context.drafts = value === "true";
			}
		} else {
			context[key] = value;
		}
	}

	return context;
};

/** Whether signal attributes mark a user's turn. */
export const isUserTurn = (
	attributes: Readonly<Record<string, string>>,
): boolean => attributes[TURN_ATTRIBUTE] === USER_TURN;

const ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
};
const UNESCAPES: Record<string, string> = Object.fromEntries(
	Object.entries(ESCAPES).map(([raw, entity]) => [entity, raw]),
);

// The preamble at the start of the body and its separator; values hold only escaped text.
const PREAMBLE = new RegExp(
	`^<${CONTEXT_SIGNAL_TYPE}((?: [A-Za-z]+="(?:[^"<>&]|&(?:amp|lt|gt|quot);)*")*)/>\\n\\n`,
);
const ATTRIBUTE = /([A-Za-z]+)="([^"]*)"/g;

/**
 * The body of a user's turn sent as a Flue `user` message: a self-closing
 * `payload-context` tag carrying the context and the user turn marker, a
 * blank line, then the user's text as typed.
 */
export const userTurnBody = (context: ChatContext, text: string): string => {
	const attributes = Object.entries({
		...encodeContext(context),
		[TURN_ATTRIBUTE]: USER_TURN,
	})
		.map(
			([name, value]) =>
				`${name}="${value.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char)}"`,
		)
		.join(" ");

	return `<${CONTEXT_SIGNAL_TYPE} ${attributes}/>\n\n${text}`;
};

/**
 * The context and the user's text of a body written by {@link userTurnBody},
 * or `undefined` when the body does not start with its preamble. A tag
 * anywhere else is the user's text.
 */
export const readUserTurnBody = (
	body: string,
): { context: ChatContext; text: string } | undefined => {
	const match = PREAMBLE.exec(body);

	if (!match) {
		return undefined;
	}

	const attributes: Record<string, string> = {};

	for (const [, name = "", value = ""] of (match[1] ?? "").matchAll(
		ATTRIBUTE,
	)) {
		attributes[name] = value.replace(
			/&(?:amp|lt|gt|quot);/g,
			(entity) => UNESCAPES[entity] ?? entity,
		);
	}

	return {
		context: decodeContext(attributes),
		text: body.slice(match[0].length),
	};
};
