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
	assertStartedFilesCollection,
	withThreadField,
} from "./files/collection.js";
import { FACTORY_USER_COLLECTION } from "./files/factory.js";
import {
	bindAgentUpload,
	guardFiles,
	isBindHook,
	isFileGuard,
} from "./files/guard.js";
import { createDispatchTask } from "./jobs/dispatch.js";
import { QUEUE_SETTINGS_KEY } from "./jobs/queue.js";
import {
	augmentKeyCollection,
	capabilityFields,
	validateGrants,
} from "./keys/augment.js";
import { disableUserKeys } from "./keys/manager.js";
import { invalid, normalizeOptions } from "./options.js";
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
	GlobalConfig,
	InvalidConfiguration,
} from "payload";

const ADMIN_ENTRY = "@abinnovision/payloadcms-flue/admin";

// The operations the thread guard narrows on the files collection.
const GUARDED = ["read", "readVersions", "update", "delete"] as const;

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
		const { admin } = settings;
		const bridged =
			(kind: "collections" | "globals") =>
			<T extends CollectionConfig | GlobalConfig>(entity: T): T =>
				admin && admin.bridges(kind, entity.slug) ? withBridge(entity) : entity;
		const withDocumentBridge = bridged("collections");
		const guardSettings = settings.files && {
			...settings,
			files: settings.files,
		};
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
					validateGrants(capabilityMap, settings, logger);

					return keys;
				}

				if (
					guardSettings &&
					collection.slug === guardSettings.files.collection
				) {
					assertFilesCollection(collection, logger);

					const factoryUsers: unknown =
						collection.custom?.[FACTORY_USER_COLLECTION];

					if (factoryUsers !== undefined && factoryUsers !== userCollection) {
						throw invalid(
							`The files collection "${collection.slug}" was built for users of ${JSON.stringify(factoryUsers)}, but mcpx's user collection is "${userCollection}". Pass userCollection to fluePrivateUploads.`,
						);
					}

					return withDocumentBridge(
						withThreadField(
							collection,
							settings.threads.slug,
							bindAgentUpload(guardSettings),
						),
					);
				}

				if (collection.slug === userCollection) {
					return withDocumentBridge({
						...collection,
						hooks: {
							...collection.hooks,
							afterLogout: [
								...(collection.hooks?.afterLogout ?? []),
								disableKeysOnLogout(settings),
							],
						},
					});
				}

				return withDocumentBridge(collection);
			},
		);

		const threads = createThreadsCollection(settings);
		const baseAccess = config.baseAccess?.collections;

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
			...(guardSettings
				? {
						baseAccess: {
							...config.baseAccess,
							collections: {
								...baseAccess,
								...Object.fromEntries(
									GUARDED.map((operation) => [
										operation,
										guardFiles(
											baseAccess?.[operation],
											guardSettings,
											operation,
										),
									]),
								),
							},
						},
					}
				: {}),
			globals: (config.globals ?? []).map(bridged("globals")),
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

				if (settings.files) {
					const files = payload.collections[settings.files.collection]?.config;

					// A storage adapter or a later plugin may change the collection after flue ran.
					if (!files) {
						throw invalid(
							`files.collection "${settings.files.collection}" is not in the config.`,
						);
					}

					assertFilesCollection(files, { warn: () => undefined });

					if (
						files.flattenedFields.some((field) => field.name === "download")
					) {
						throw invalid(
							`The files collection "${files.slug}" must not have a top-level field named "download": mcpx serves no files of such a collection.`,
						);
					}

					const guarded = payload.config.baseAccess?.collections;

					if (
						!GUARDED.every((operation) => isFileGuard(guarded?.[operation]))
					) {
						throw invalid(
							"Another plugin replaced config.baseAccess after flue, which drops the thread guard on the files collection. Register it before flue.",
						);
					}

					await assertStartedFilesCollection(
						files,
						settings.mcpx.userCollection,
					);

					if (!files.hooks.beforeChange.some(isBindHook)) {
						throw invalid(
							`Another plugin removed flue's hook from the files collection "${files.slug}", which binds agent uploads to their thread.`,
						);
					}
				}

				for (const message of warnings) {
					payload.logger.warn(message);
				}

				await config.onInit?.(payload);
			},
		};
	},
});
