import {
	CONTEXT_SIGNAL_TYPE,
	decodeContext,
	readUserTurnBody,
} from "../protocol/context.js";

import type { ChatContext, UserTurnBody } from "../protocol/context.js";
import type { WorkspaceFileRef } from "../protocol/files.js";
import type { DeliveredAttachment, DeliveredMessage } from "@flue/runtime";

// The body of a user's turn, of either shape.
const turnBodyOf = (delivery: DeliveredMessage): undefined | UserTurnBody =>
	delivery.kind === "user" || delivery.type === CONTEXT_SIGNAL_TYPE
		? readUserTurnBody(delivery.body)
		: undefined;

/**
 * The context Payload sent with a delivery, from either turn shape: the
 * attributes of a `payload-context` signal, or the preamble of a `user`
 * message that carries attachments. `undefined` for any other delivery.
 */
export const contextOf = (
	delivery: DeliveredMessage,
): ChatContext | undefined => {
	if (delivery.kind === "user") {
		return readUserTurnBody(delivery.body)?.context;
	}

	return delivery.type === CONTEXT_SIGNAL_TYPE &&
		delivery.attributes !== undefined
		? decodeContext(delivery.attributes)
		: undefined;
};

/**
 * The files of a user's turn: the text files Payload inlined into the body,
 * as base64 UTF-8 `document` attachments with their own MIME type, then
 * Flue's attachments, the order the panel shows them in. Empty for any other
 * delivery. A text file cannot go back to Flue as a document, which takes
 * only PDFs.
 */
export const attachmentsOf = (
	delivery: DeliveredMessage,
): DeliveredAttachment[] => [
	...(turnBodyOf(delivery)?.inline ?? []),
	...(delivery.kind === "user" ? (delivery.attachments ?? []) : []),
];

/**
 * The workspace files a user's turn references, in the order the panel
 * shows them. Read them with `payload.files`. Empty for any other delivery.
 * `name` is the uploader's and untrusted.
 */
export const filesOf = (delivery: DeliveredMessage): WorkspaceFileRef[] =>
	turnBodyOf(delivery)?.files ?? [];
