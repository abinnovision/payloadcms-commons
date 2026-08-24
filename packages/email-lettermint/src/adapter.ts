import { InvalidConfiguration } from "payload";

import { normalizeAddress } from "./address.js";
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT, sendMessage } from "./client.js";
import { toSendMailRequest } from "./message.js";

import type { ClientOptions } from "./client.js";
import type { MessageDefaults } from "./message.js";
import type { LettermintAdapterArgs, LettermintSendResponse } from "./types.js";
import type { EmailAdapter } from "payload";

const ADAPTER_NAME = "lettermint";

const fail = (message: string): never => {
	throw new InvalidConfiguration(`[payloadcms-email-lettermint] ${message}`);
};

const requireValue = (value: string | undefined, field: string): string => {
	if (typeof value !== "string" || value.trim() === "") {
		return fail(`${field} is required.`);
	}

	return value;
};

/**
 * Sends Payload's transactional mail through Lettermint.
 *
 * Configuration is checked here, while the config is being built, so a missing
 * token fails at startup rather than on the first password reset.
 */
const lettermintAdapter = (
	args: LettermintAdapterArgs,
): EmailAdapter<LettermintSendResponse> => {
	const apiToken = requireValue(args.apiToken, "apiToken");
	const defaultFromAddress = requireValue(
		args.defaultFromAddress,
		"defaultFromAddress",
	);
	const defaultFromName = requireValue(args.defaultFromName, "defaultFromName");

	if (
		args.timeout !== undefined &&
		(!Number.isFinite(args.timeout) || args.timeout <= 0)
	) {
		fail("timeout must be a positive number of milliseconds.");
	}

	const client: ClientOptions = {
		apiToken,
		baseUrl: (args.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
		timeout: args.timeout ?? DEFAULT_TIMEOUT,
	};

	const defaults: MessageDefaults = {
		from: normalizeAddress({
			name: defaultFromName,
			address: defaultFromAddress,
		}),
		route: args.route,
		settings: args.settings,
		metadata: args.metadata,
		tags: args.tags,
		overrideRecipientAddress: args.overrideRecipientAddress,
	};

	return ({ payload }) => ({
		name: ADAPTER_NAME,
		defaultFromAddress,
		defaultFromName,
		sendEmail: async (message) => {
			const { body, dropped } = await toSendMailRequest(message, defaults);

			if (dropped.length > 0) {
				payload.logger.warn(
					`[payloadcms-email-lettermint] Ignoring ${dropped.join(", ")}: the Lettermint API has no equivalent.`,
				);
			}

			return await sendMessage(body, client);
		},
	});
};

export { lettermintAdapter };
