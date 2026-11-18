import { base64ToText, isTextMimeType, textToBase64 } from "./attachments.js";

import type { DeliveredAttachment } from "./attachments.js";

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

// Attributes whose values hold only escaped text.
const ATTRIBUTES = '((?: [A-Za-z]+="(?:[^"<>&]|&(?:amp|lt|gt|quot);)*")*)';

// The preamble at the start of the body and its separator.
const PREAMBLE = new RegExp(`^<${CONTEXT_SIGNAL_TYPE}${ATTRIBUTES}/>\\n\\n`);
const ATTRIBUTE = /([A-Za-z]+)="([^"]*)"/g;

// The tag that wraps a text file inlined into a user's turn.
const TEXT_FILE_TAG = "payload-file";

// The attribute of the preamble that counts the text files after it.
const FILES_ATTRIBUTE = "files";

// The opening tag of a text file at the start of the rest of the body.
const FILE_OPEN = new RegExp(`^<${TEXT_FILE_TAG}${ATTRIBUTES}>\\n`);
const FILE_CLOSE = `\n</${TEXT_FILE_TAG}>\n\n`;

const writeAttributes = (attributes: Record<string, string>): string =>
	Object.entries(attributes)
		.map(
			([name, value]) =>
				` ${name}="${value.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char)}"`,
		)
		.join("");

const readAttributes = (source: string): Record<string, string> => {
	const attributes: Record<string, string> = {};

	for (const [, name = "", value = ""] of source.matchAll(ATTRIBUTE)) {
		attributes[name] = value.replace(
			/&(?:amp|lt|gt|quot);/g,
			(entity) => UNESCAPES[entity] ?? entity,
		);
	}

	return attributes;
};

/**
 * The body of a user's turn sent as a Flue `user` message: a self-closing
 * `payload-context` tag carrying the context and the user turn marker, a
 * blank line, the text files each in a `payload-file` tag, then the user's
 * text as typed. A file's `length` counts its text in UTF-16 code units, so
 * the text may hold anything, the closing tag included.
 */
export const userTurnBody = (
	context: ChatContext,
	text: string,
	files: readonly DeliveredAttachment[] = [],
): string => {
	const preamble = writeAttributes({
		...encodeContext(context),
		[TURN_ATTRIBUTE]: USER_TURN,
		...(files.length > 0 ? { [FILES_ATTRIBUTE]: String(files.length) } : {}),
	});
	const blocks = files.map((file) => {
		const content = base64ToText(file.data) ?? "";
		const attributes = writeAttributes({
			...(file.filename === undefined ? {} : { filename: file.filename }),
			mimeType: file.mimeType,
			length: String(content.length),
		});

		return `<${TEXT_FILE_TAG}${attributes}>\n${content}${FILE_CLOSE}`;
	});

	return `<${CONTEXT_SIGNAL_TYPE}${preamble}/>\n\n${blocks.join("")}${text}`;
};

/*
 * The text files at the start of the rest of a body and the text after
 * them, or `undefined` when the body does not hold `count` well-formed files.
 */
const readTextFiles = (
	rest: string,
	count: number,
): { files: DeliveredAttachment[]; text: string } | undefined => {
	const files: DeliveredAttachment[] = [];
	let remaining = rest;

	while (files.length < count) {
		const open = FILE_OPEN.exec(remaining);
		const attributes = readAttributes(open?.[1] ?? "");
		const { filename, mimeType = "", length = "" } = attributes;
		const start = open?.[0].length ?? 0;
		const end = start + Number(length);

		if (
			!open ||
			!isTextMimeType(mimeType) ||
			!/^\d+$/.test(length) ||
			!remaining.startsWith(FILE_CLOSE, end)
		) {
			return undefined;
		}

		files.push({
			type: "document",
			data: textToBase64(remaining.slice(start, end)),
			mimeType,
			...(filename === undefined ? {} : { filename }),
		});
		remaining = remaining.slice(end + FILE_CLOSE.length);
	}

	return { files, text: remaining };
};

/**
 * The context, the text files and the user's text of a body written by
 * {@link userTurnBody}, or `undefined` when the body does not start with its
 * preamble or lacks a file the preamble counts. A tag anywhere else is the
 * user's text. The files come back as base64 UTF-8 text.
 */
export const readUserTurnBody = (
	body: string,
):
	| { context: ChatContext; files: DeliveredAttachment[]; text: string }
	| undefined => {
	const match = PREAMBLE.exec(body);

	if (!match) {
		return undefined;
	}

	const attributes = readAttributes(match[1] ?? "");
	const count = Number(attributes[FILES_ATTRIBUTE] ?? "0");
	const read = Number.isSafeInteger(count)
		? readTextFiles(body.slice(match[0].length), count)
		: undefined;

	return read === undefined
		? undefined
		: { context: decodeContext(attributes), ...read };
};
