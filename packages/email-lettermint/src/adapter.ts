import { InvalidConfiguration } from "payload";

import { normalizeAddress } from "./address.js";
import { createLettermintClient, sendMessage } from "./client.js";
import { toSendMailRequest } from "./message.js";

import type { MessageDefaults } from "./message.js";
import type { LettermintAdapterArgs, LettermintSendResponse } from "./types.js";
import type { LettermintClient } from "lettermint";
import type { EmailAdapter } from "payload";

/**
 * Throws an InvalidConfiguration error with the given message.
 *
 * @param message The error message to throw.
 */
const fail = (message: string): never => {
	throw new InvalidConfiguration(`[payloadcms-email-lettermint] ${message}`);
};

/**
 * Ensures a string value is present, throwing an error if not.
 *
 * @param value Input value to check.
 * @param field Name of the field being checked, used in the error message.
 */
const requireValue = (value: string | undefined, field: string): string => {
	if (typeof value !== "string" || value.trim() === "") {
		return fail(`${field} is required.`);
	}

	return value;
};

/**
 * Checks if a value is a finite positive number.
 *
 * @param value The value to check.
 */
const isFinitePositiveNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Sends Payload's transactional mail through Lettermint.
 *
 * Configuration is checked here, while the config is being built, so a missing
 * token fails at startup rather than on the first password reset.
 */
export const lettermintAdapter = (
	args: LettermintAdapterArgs,
): EmailAdapter<LettermintSendResponse> => {
	/*
	 * Decide which LettermintClient to use. We either use the one provided in args,
	 * or create a new one from the provided configuration.
	 */
	let client: LettermintClient;
	if ("client" in args) {
		client = args.client;
	} else {
		// Validate the given timeout.
		if (args.timeout !== undefined && !isFinitePositiveNumber(args.timeout)) {
			fail("timeout must be a positive number of milliseconds.");
		}

		client = createLettermintClient({
			apiToken: requireValue(args.apiToken, "apiToken"),
			baseUrl: args.baseUrl?.replace(/\/+$/, "") ?? undefined,
			timeout: args.timeout ?? undefined,
		});
	}

	const defaultFromAddress = requireValue(
		args.defaultFromAddress,
		"defaultFromAddress",
	);
	const defaultFromName = requireValue(args.defaultFromName, "defaultFromName");

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

	// Create the payload compatible adapter factory.
	return ({ payload }) => ({
		name: "lettermint",
		defaultFromAddress,
		defaultFromName,
		sendEmail: async (message) => {
			// Transform the Payload message into a Lettermint send request, applying defaults.
			const { body, dropped } = await toSendMailRequest(message, defaults);

			// Log the dropped properties.
			if (dropped.length > 0) {
				payload.logger.warn(
					`[payloadcms-email-lettermint] Ignoring ${dropped.join(", ")}`,
				);
			}

			return await sendMessage(body, client);
		},
	});
};
