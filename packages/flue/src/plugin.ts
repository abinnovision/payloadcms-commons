import { definePlugin } from "payload";

import { abortHandler } from "./endpoints/abort.js";
import { agentsHandler } from "./endpoints/agents.js";
import { chatHandler } from "./endpoints/chat.js";
import {
	conversationAttachmentHandler,
	conversationHandler,
} from "./endpoints/conversation.js";
import { exchangeHandler } from "./endpoints/exchange.js";
import { settledHandler } from "./endpoints/settled.js";
import { createDispatchTask } from "./jobs/dispatch.js";
import { QUEUE_SETTINGS_KEY } from "./jobs/queue.js";
import {
	augmentKeyCollection,
	capabilityFields,
	validateGrants,
} from "./keys/augment.js";
import { disableUserKeys } from "./keys/manager.js";
import { normalizeOptions } from "./options.js";
import { FLUE_ROUTES } from "./protocol/paths.js";
import { createThreadsCollection } from "./threads/collection.js";

import type { QueueSettings } from "./jobs/queue.js";
import type { CapabilityFieldMap } from "./keys/augment.js";
import type { NormalizedOptions, StartupLogger } from "./options.js";
import type { PluginSettings } from "./turn.js";
import type { FluePluginOptions } from "./types.js";
import type {
	CollectionAfterLogoutHook,
	CollectionConfig,
	Endpoint,
	InvalidConfiguration,
} from "payload";

const ADMIN_ENTRY = "@abinnovision/payloadcms-flue/admin";

/*
 * Logging out disables the user's managed keys; the next turn enables them.
 * The hook runs inside the logout transaction, where a throw fails the logout.
 */
const disableKeysOnLogout =
	(settings: NormalizedOptions): CollectionAfterLogoutHook =>
	async ({ req }) => {
		if (!req.user) {
			return;
		}

		try {
			await disableUserKeys(req.payload, settings, {
				userId: req.user.id,
				req,
			});
		} catch (error) {
			req.payload.logger.error({
				err: error,
				msg: "[payloadcms-flue] Could not disable the managed mcpx keys of a user who logged out.",
			});
		}
	};

/**
 * Validates the options when the config is built, adds the threads
 * collection, locks flue's keys on mcpx's key collection and mounts the admin
 * chat. Runs after mcpx (`order: 100`), whose options and API key collection
 * it reads.
 */
export const fluePlugin = definePlugin<FluePluginOptions>({
	slug: "@abinnovision/payloadcms-flue",
	order: 200,
	plugin: ({ config, options, plugins }) => {
		// No logger exists while the config is built, so warnings wait for onInit.
		const warnings: string[] = [];
		const failures: InvalidConfiguration[] = [];
		const logger: StartupLogger = {
			warn: (message) => warnings.push(message),
			fail: (error) => failures.push(error),
		};

		const settings = normalizeOptions(config, options, plugins, logger);
		const { apiKeysSlug, userCollection } = settings.mcpx;
		// normalizeOptions has checked that the key collection is in the config.
		let capabilityMap: CapabilityFieldMap = {
			collections: {},
			globals: {},
			tools: [],
		};

		const collections = (config.collections ?? []).map(
			(collection): CollectionConfig => {
				if (collection.slug === apiKeysSlug) {
					const keys = augmentKeyCollection(collection);

					capabilityMap = capabilityFields(keys);
					validateGrants(capabilityMap, settings.agents, logger);

					return keys;
				}

				if (collection.slug === userCollection) {
					return {
						...collection,
						hooks: {
							...collection.hooks,
							afterLogout: [
								...(collection.hooks?.afterLogout ?? []),
								disableKeysOnLogout(settings),
							],
						},
					};
				}

				return collection;
			},
		);

		const threads = createThreadsCollection(settings);
		const full: PluginSettings = { ...settings, capabilityMap };
		const endpoint = (
			route: keyof typeof FLUE_ROUTES,
			method: Endpoint["method"],
			handler: Endpoint["handler"],
		): Endpoint => ({
			path: `${settings.endpointPath}${FLUE_ROUTES[route]}`,
			method,
			handler,
		});

		return {
			...config,
			collections: [
				...collections,
				options.threads?.overrideCollection?.(threads) ?? threads,
			],
			endpoints: [
				...(config.endpoints ?? []),
				endpoint("agents", "get", agentsHandler(full)),
				endpoint("chat", "post", chatHandler(full)),
				endpoint("conversation", "get", conversationHandler(full)),
				endpoint("conversationAbort", "post", abortHandler(full)),
				endpoint(
					"conversationAttachment",
					"get",
					conversationAttachmentHandler(full),
				),
				endpoint("exchange", "post", exchangeHandler(full)),
				endpoint("settled", "post", settledHandler(full)),
			],
			jobs: {
				...config.jobs,
				tasks: [...(config.jobs?.tasks ?? []), createDispatchTask(full)],
			},
			custom: {
				...config.custom,
				[QUEUE_SETTINGS_KEY]: {
					queue: settings.dispatch.queue,
					agents: settings.agents.map((agent) => agent.slug),
				} satisfies QueueSettings,
			},
			admin: {
				...config.admin,
				components: {
					...config.admin?.components,
					// A provider stays mounted across admin navigation, and so does the chat.
					providers: [
						...(config.admin?.components?.providers ?? []),
						{
							path: ADMIN_ENTRY,
							exportName: "FlueProvider",
							clientProps: {
								endpointPath: settings.endpointPath,
								threadsSlug: settings.threads.slug,
								userCollection: settings.mcpx.userCollection,
								mcpxEndpointPath: settings.mcpx.endpointPath,
							},
						},
					],
					actions: [
						...(config.admin?.components?.actions ?? []),
						{ path: ADMIN_ENTRY, exportName: "FlueToggle" },
					],
				},
			},
			onInit: async (payload) => {
				const [failure] = failures;

				if (failure) {
					throw failure;
				}

				for (const message of warnings) {
					payload.logger.warn(message);
				}

				await config.onInit?.(payload);
			},
		};
	},
});
