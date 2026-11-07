import { flattenTopLevelFields } from "payload";

import { createEndpoints } from "./endpoints.js";
import {
	DEFAULT_MAX_SESSION_AGE,
	DEFAULT_SCOPES,
	validateOptions,
} from "./options.js";
import { ROLES_FIELD, roleOptions } from "./roles.js";
import { createStrategy, SIGNED_IN_AT_FIELD } from "./session.js";

import type { OidcSettings } from "./endpoints.js";
import type { OidcPluginOptions } from "./options.js";
import type { CollectionConfig, Config, Field, Plugin } from "payload";

/** Import paths of the admin components; they must match the `./admin` export. */
export const LOGIN_COMPONENT = "@abinnovision/payloadcms-oidc/admin#OidcLogin";
export const LOGOUT_COMPONENT =
	"@abinnovision/payloadcms-oidc/admin#OidcLogoutButton";

/** Server props the plugin passes to `OidcLogin`. */
export interface OidcLoginServerProps {
	loginURL: string;
	autoRedirect: boolean;
}

/** Client props the plugin passes to `OidcLogoutButton`. */
export interface OidcLogoutClientProps {
	logoutURL: string;
}

const trimSlash = (value: string): string => value.replace(/\/+$/, "");

const joinPath = (...parts: string[]): string =>
	`/${parts
		.map((part) => part.replace(/^\/+|\/+$/g, ""))
		.filter(Boolean)
		.join("/")}`;

/** Written only by the plugin: readable in the admin, never editable through any API. */
const managed = {
	readOnly: true,
	position: "sidebar",
} as const;

const noWrites = { create: () => false, update: () => false };

/** Fields only the plugin may write, whether it adds them or the collection defines them. */
const LOCKED_FIELDS = new Set(["sub", ROLES_FIELD, SIGNED_IN_AT_FIELD]);

const isNamed = (field: Field, name: string): boolean =>
	"name" in field && field.name === name;

/**
 * The top-level field with this name. A field of that name nested in a row,
 * collapsible or tab is rejected: the plugin could neither find nor lock it.
 */
const hasField = (
	collection: CollectionConfig,
	name: string,
): Field | undefined => {
	const field = collection.fields.find((entry) => isNamed(entry, name));

	if (
		!field &&
		flattenTopLevelFields(collection.fields).some((entry) =>
			isNamed(entry as Field, name),
		)
	) {
		throw new Error(
			`[payloadcms-oidc] The \`${name}\` field on "${collection.slug}" must be a top-level field.`,
		);
	}

	return field;
};

/** Takes write access away from the collection's own `sub`, `roles` and `lastSignInAt`. */
const lockFields = (fields: Field[]): Field[] =>
	fields.map((field) => {
		if (!("name" in field) || !LOCKED_FIELDS.has(field.name)) {
			return field;
		}

		const access = "access" in field ? field.access : undefined;

		const locked = { ...field, access: { ...access, ...noWrites } };

		return locked as Field;
	});

const managedFields = (
	collection: CollectionConfig,
	roles: readonly string[] | undefined,
): Field[] => {
	const added: Field[] = [];
	const missing = (name: string): boolean =>
		hasField(collection, name) === undefined;

	if (missing("sub")) {
		added.push({
			name: "sub",
			type: "text",
			label: "Subject",
			// Not required, so a collection with existing rows can adopt the plugin.
			unique: true,
			access: noWrites,
			admin: {
				...managed,
				description: "The user's identifier at the identity provider.",
			},
		});
	}

	if (missing("email")) {
		added.push({ name: "email", type: "email", admin: { readOnly: true } });
	}

	if (missing("name")) {
		added.push({ name: "name", type: "text", admin: { readOnly: true } });
	}

	if (roles && missing(ROLES_FIELD)) {
		added.push({
			name: ROLES_FIELD,
			type: "select",
			hasMany: true,
			options: [...roles],
			access: noWrites,
			admin: {
				...managed,
				description: "Assigned by the identity provider on every sign-in.",
			},
		});
	}

	if (missing(SIGNED_IN_AT_FIELD)) {
		added.push({
			name: SIGNED_IN_AT_FIELD,
			type: "date",
			label: "Last sign-in",
			access: noWrites,
			admin: { ...managed, date: { pickerAppearance: "dayAndTime" } },
		});
	}

	return added;
};

/**
 * The roles the field accepts: the options of an existing `roles` select
 * field, else the ones derivable from the role options.
 */
const allowedRoles = (
	collection: CollectionConfig,
	options: OidcPluginOptions,
): readonly string[] | undefined => {
	if (!options.roles) {
		return undefined;
	}

	const existing = hasField(collection, ROLES_FIELD);

	if (existing) {
		if (existing.type !== "select" || !existing.hasMany) {
			throw new Error(
				`[payloadcms-oidc] The existing \`${ROLES_FIELD}\` field on "${collection.slug}" must be a select field with \`hasMany: true\`.`,
			);
		}

		return existing.options.map((option) =>
			typeof option === "string" ? option : option.value,
		);
	}

	const derived = roleOptions(options.roles);

	if (!derived?.length) {
		throw new Error(
			"[payloadcms-oidc] `roles.options` is required when `roles.map` is a function or omitted.",
		);
	}

	return derived;
};

const resolveSettings = (
	config: Config,
	collection: CollectionConfig,
	options: OidcPluginOptions,
): OidcSettings => {
	const serverURL = options.serverURL ?? config.serverURL;

	if (!serverURL) {
		throw new Error(
			"[payloadcms-oidc] Set `serverURL` on the Payload config or the plugin; the provider redirects back to it.",
		);
	}

	const adminRoute = config.routes?.admin ?? "/admin";
	const endpointPath = joinPath(
		config.routes?.api ?? "/api",
		collection.slug,
		"oidc",
	);

	return {
		options,
		slug: collection.slug,
		scopes: options.scopes ?? DEFAULT_SCOPES,
		endpointURL: `${trimSlash(serverURL)}${endpointPath}`,
		loginPath: joinPath(adminRoute, config.admin?.routes?.login ?? "/login"),
		adminPath: joinPath(adminRoute),
		allowedRoles: allowedRoles(collection, options),
	};
};

const takeOver = (
	collection: CollectionConfig,
	settings: OidcSettings,
): CollectionConfig => {
	const auth = typeof collection.auth === "object" ? collection.auth : {};

	return {
		...collection,
		auth: {
			...auth,
			cookies: {
				...auth.cookies,
				secure:
					auth.cookies?.secure ?? settings.endpointURL.startsWith("https:"),
			},
			disableLocalStrategy: true,
			useSessions: false,
			strategies: [
				...(auth.strategies ?? []),
				createStrategy({
					slug: settings.slug,
					maxSessionAge:
						settings.options.maxSessionAge ?? DEFAULT_MAX_SESSION_AGE,
				}),
			],
		},
		fields: [
			...lockFields(collection.fields),
			...managedFields(collection, settings.allowedRoles),
		],
		endpoints: [
			...(Array.isArray(collection.endpoints) ? collection.endpoints : []),
			...createEndpoints(settings),
		],
	};
};

const withAdminComponents = (
	admin: Config["admin"],
	settings: OidcSettings,
): NonNullable<Config["admin"]> => {
	const endpointPath = new URL(settings.endpointURL).pathname;
	const login: OidcLoginServerProps = {
		loginURL: `${endpointPath}/login`,
		autoRedirect: settings.options.autoRedirect ?? true,
	};
	const logout: OidcLogoutClientProps = {
		logoutURL: `${endpointPath}/logout`,
	};
	const components = admin?.components;

	return {
		...admin,
		components: {
			...components,
			beforeLogin: [
				...(components?.beforeLogin ?? []),
				{ path: LOGIN_COMPONENT, serverProps: login },
			],
			logout: {
				...components?.logout,
				Button: components?.logout?.Button ?? {
					path: LOGOUT_COMPONENT,
					clientProps: logout,
				},
			},
		},
	};
};

/**
 * Hands all authentication of one auth collection to an OpenID Connect
 * provider: password login is disabled, users are provisioned and updated
 * from the provider's claims on every sign-in, and the admin login page
 * forwards to the provider.
 */
export const oidcPlugin = (options: OidcPluginOptions): Plugin => {
	validateOptions(options);

	const plugin: Plugin = (config: Config): Config => {
		// Payload's own default for `admin.user`: the first auth collection.
		const adminUser =
			config.admin?.user ??
			config.collections?.find((entry) => entry.auth)?.slug;
		const slug = options.collection ?? adminUser;
		const collection = config.collections?.find((entry) => entry.slug === slug);

		if (!collection?.auth) {
			throw new Error(
				`[payloadcms-oidc] No auth collection "${slug ?? ""}". Define one, or point \`collection\` at it.`,
			);
		}

		const settings = resolveSettings(config, collection, options);

		return {
			...config,
			collections: (config.collections ?? []).map((entry) =>
				entry === collection ? takeOver(entry, settings) : entry,
			),
			// The login page and logout button belong to the admin user collection.
			...(collection.slug === adminUser
				? { admin: withAdminComponents(config.admin, settings) }
				: {}),
		};
	};

	plugin.slug = "oidc";

	return plugin;
};
