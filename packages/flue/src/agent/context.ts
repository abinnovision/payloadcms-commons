import {
	CONTEXT_SIGNAL_TYPE,
	decodeContext,
	readUserTurnBody,
} from "../protocol/context.js";
import { readFileAttributes } from "../protocol/files.js";

import type { ChatContext } from "../protocol/context.js";
import type { FileRef } from "../protocol/files.js";
import type { DeliveredMessage } from "@flue/runtime";

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
 * The files a user's turn carries, in the order the user sent them, from
 * either turn shape. `attached` marks the ones that also reached the model
 * as Flue attachments; read any of them with `payload.download`. Empty for
 * any other delivery. `name` is the uploader's and untrusted.
 */
export const filesOf = (delivery: DeliveredMessage): FileRef[] => {
	if (delivery.kind === "user") {
		return readUserTurnBody(delivery.body)?.files ?? [];
	}

	return delivery.type === CONTEXT_SIGNAL_TYPE &&
		delivery.attributes !== undefined
		? readFileAttributes(delivery.attributes)
		: [];
};
