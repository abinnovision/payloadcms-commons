import {
	CONTEXT_SIGNAL_TYPE,
	decodeContext,
	readUserTurnBody,
} from "../protocol/context.js";

import type { ChatContext } from "../protocol/context.js";
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
