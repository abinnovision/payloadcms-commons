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
import {
	assertFilesCollection,
	assertFilesStarted,
	withThreadField,
} from "./files/collection.js";
import { SCOPE_SETTINGS_KEY } from "./files/scope.js";
import { capabilityFields, validateGrants } from "./grants.js";
import { createDispatchTask } from "./jobs/dispatch.js";
import { QUEUE_SETTINGS_KEY } from "./jobs/queue.js";
import { normalizeOptions } from "./options.js";
import { FLUE_ROUTES } from "./protocol/paths.js";
import { createThreadsCollection } from "./threads/collection.js";
import { assertTokenKv, closeUserWindows } from "./tokens/store.js";
import {
	createTokenStrategy,
	refuseTokenRefresh,
	tokenMe,
} from "./tokens/strategy.js";

import type { ScopeSettings } from "./files/scope.js";
import type { QueueSettings } from "./jobs/queue.js";
import type { StartupLogger } from "./options.js";
import type { FluePluginOptions } from "./types.js";
import type {
	CollectionAfterLogoutHook,
	CollectionConfig,
	Endpoint,
	GlobalConfig,
	InvalidConfiguration,
} from "payload";

const ADMIN_ENTRY = "@abinnovision/payloadcms-flue/admin";

/*
 * Keeps the open edit view in step with the agent's writes. Rendered inside
 * the document's form, which the chat's provider sits above.
 */
const withBridge = <T extends CollectionConfig | GlobalConfig>(
	entity: T,
): T => ({
	...entity,
	admin: {
		...entity.admin,
		components: {
			...entity.admin?.components,
			edit: {
				...entity.admin?.components?.edit,
				beforeDocumentControls: [
					...(entity.admin?.components?.edit?.beforeDocumentControls ?? []),
					{ path: ADMIN_ENTRY, exportName: "FlueDocumentBridge" },
				],
			},
		},
	},
});

/*
 * Logging out closes every live window of the user, so none of their agent
 * tokens authenticates until a turn opens a window again. It runs inside the
 * logout transaction: a failure fails the logout, and a rolled-back logout
 * keeps the windows.
 */
const closeWindowsOnLogout: CollectionAfterLogoutHook = async ({ req }) => {
	if (req.user) {
		await closeUserWindows(req.payload, req.user.id, req);
	}
};

/**
 * Validates the options when the config is built, adds the threads
 * collection, registers the `flue-token` auth strategy on mcpx's user
 * collection and mounts the admin chat. Runs after mcpx (`order: 100`), whose
 * options and API key collection it reads.
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
		const { admin } = settings;
		const bridged =
			(kind: "collections" | "globals") =>
			<T extends CollectionConfig | GlobalConfig>(entity: T): T =>
				admin && admin.bridges(kind, entity.slug) ? withBridge(entity) : entity;
		const withDocumentBridge = bridged("collections");
		const { files } = settings;

		const collections = (config.collections ?? []).map(
			(collection): CollectionConfig => {
				// normalizeOptions has checked that the key collection is in the config.
				if (collection.slug === apiKeysSlug) {
					validateGrants(capabilityFields(collection), settings, logger);

					return collection;
				}

				if (files && collection.slug === files.collection) {
					assertFilesCollection(collection, logger);

					return withDocumentBridge(
						withThreadField(collection, settings.threads.slug),
					);
				}

				if (collection.slug === userCollection) {
					const auth =
						typeof collection.auth === "object" ? collection.auth : {};

					return withDocumentBridge({
						...collection,
						auth: {
							...auth,
							strategies: [
								...(auth.strategies ?? []),
								createTokenStrategy(settings),
							],
						},
						hooks: {
							...collection.hooks,
							beforeOperation: [
								...(collection.hooks?.beforeOperation ?? []),
								refuseTokenRefresh,
							],
							afterLogout: [
								...(collection.hooks?.afterLogout ?? []),
								closeWindowsOnLogout,
							],
							me: [...(collection.hooks?.me ?? []), tokenMe],
						},
					});
				}

				return withDocumentBridge(collection);
			},
		);

		const threads = createThreadsCollection(settings);

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
			globals: (config.globals ?? []).map(bridged("globals")),
			endpoints: [
				...(config.endpoints ?? []),
				endpoint("agents", "get", agentsHandler(settings)),
				endpoint("chat", "post", chatHandler(settings)),
				endpoint("conversation", "get", conversationHandler(settings)),
				endpoint("conversationAbort", "post", abortHandler(settings)),
				endpoint(
					"conversationAttachment",
					"get",
					conversationAttachmentHandler(settings),
				),
				endpoint("exchange", "post", exchangeHandler(settings)),
				endpoint("settled", "post", settledHandler(settings)),
			],
			jobs: {
				...config.jobs,
				tasks: [...(config.jobs?.tasks ?? []), createDispatchTask(settings)],
			},
			custom: {
				...config.custom,
				[QUEUE_SETTINGS_KEY]: {
					queue: settings.dispatch.queue,
					agents: settings.agents.map((agent) => agent.slug),
				} satisfies QueueSettings,
				[SCOPE_SETTINGS_KEY]: {
					mcpx: settings.mcpx,
					files: files && files.collection,
				} satisfies ScopeSettings,
			},
			...(admin
				? {
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
					}
				: {}),
			onInit: async (payload) => {
				const [failure] = failures;

				if (failure) {
					throw failure;
				}

				assertTokenKv(payload.config);

				if (files) {
					await assertFilesStarted(payload, files.collection, userCollection);
				}

				for (const message of warnings) {
					payload.logger.warn(message);
				}

				await config.onInit?.(payload);
			},
		};
	},
});
