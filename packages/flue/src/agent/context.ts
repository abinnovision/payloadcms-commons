import {
	CONTEXT_SIGNAL_TYPE,
	decodeContext,
	readUserTurnBody,
} from "../protocol/context.js";

import type { ChatContext } from "../protocol/context.js";
import type { DeliveredAttachment, DeliveredMessage } from "@flue/runtime";

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
): DeliveredAttachment[] =>
	delivery.kind === "user"
		? [
				...(readUserTurnBody(delivery.body)?.files ?? []),
				...(delivery.attachments ?? []),
			]
		: [];
