import type { OidcSignInContext } from "./context.js";
import type { Access, AuthenticatedUser, User } from "payload";

type RolesOf<TUser> = TUser extends { roles?: infer TRoles }
	? NonNullable<TRoles> extends readonly (infer TRole)[]
		? Extract<TRole, string>
		: never
	: never;

/**
 * A role as the generated `User` type declares it: the options of its `roles`
 * field once `payload generate:types` has run, any string before that.
 */
export type OidcRole = [RolesOf<User>] extends [never] ? string : RolesOf<User>;

/** The name of the field roles are written to. */
export const ROLES_FIELD = "roles";

export interface OidcRolesOptions {
	/**
	 * Where the raw values come from. A claim name, a path into nested claims
	 * (`["realm_access", "roles"]`), or a function over the sign-in context.
	 *
	 * A name or path is looked up in the ID token claims, then the userinfo
	 * response, then the access token payload; the first defined value wins.
	 */
	claim: string | readonly string[] | ((context: OidcSignInContext) => unknown);

	/**
	 * How raw values become roles. A lookup table from raw value to roles, or a
	 * function. Without it the raw values are used as roles directly.
	 */
	map?:
		| Readonly<Record<string, readonly OidcRole[]>>
		| ((
				values: string[],
				context: OidcSignInContext,
		  ) => readonly OidcRole[] | Promise<readonly OidcRole[]>)
		| undefined;

	/**
	 * Every role the field accepts. Defaults to the roles named in a `map`
	 * table, so it is required when `map` is a function or omitted. Ignored
	 * when the collection already defines a `roles` select field.
	 */
	options?: readonly OidcRole[] | undefined;

	/**
	 * Roles for a user the mapping gives none. Without it, such a user is
	 * refused at sign-in.
	 */
	default?: readonly OidcRole[] | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads a claim by name or path from the ID token claims, the userinfo
 * response and the access token payload, in that order.
 */
export const readClaim = (
	context: Pick<OidcSignInContext, "accessToken" | "claims" | "userinfo">,
	path: string | readonly string[],
): unknown => {
	const segments = typeof path === "string" ? [path] : path;

	for (const source of [
		context.claims,
		context.userinfo,
		context.accessToken,
	]) {
		const value = segments.reduce<unknown>(
			(node, key) =>
				isRecord(node) && Object.hasOwn(node, key) ? node[key] : undefined,
			source,
		);

		if (value !== undefined) {
			return value;
		}
	}

	return undefined;
};

/**
 * Normalizes a claim value to strings: a string, the strings of an array, or
 * the keys of an object (the shape Zitadel uses for project roles).
 */
export const toStrings = (value: unknown): string[] => {
	if (typeof value === "string") {
		return [value];
	}

	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}

	return isRecord(value) ? Object.keys(value) : [];
};

/**
 * The roles the `roles` field is created with, or undefined when they cannot
 * be derived from the options.
 */
export const roleOptions = (
	options: OidcRolesOptions,
): readonly string[] | undefined => {
	if (options.options) {
		return options.options;
	}

	if (isRecord(options.map)) {
		return [...new Set(Object.values(options.map).flat())];
	}

	return undefined;
};

/**
 * Resolves the roles for one sign-in. Values outside `allowed` are dropped;
 * an empty result falls back to `default`.
 */
export const resolveRoles = async (
	options: OidcRolesOptions,
	context: OidcSignInContext,
	allowed: readonly string[],
): Promise<string[]> => {
	const raw =
		typeof options.claim === "function"
			? await options.claim(context)
			: readClaim(context, options.claim);
	const values = toStrings(raw);
	const { map } = options;

	let mapped: readonly string[];

	if (map === undefined) {
		mapped = values;
	} else if (typeof map === "function") {
		mapped = await map(values, context);
	} else {
		mapped = values.flatMap((value) =>
			Object.hasOwn(map, value) ? (map[value] ?? []) : [],
		);
	}

	const roles = [...new Set(mapped)].filter((role) => allowed.includes(role));

	return roles.length > 0 ? roles : [...(options.default ?? [])];
};

/**
 * Whether the user holds at least one of the roles.
 */
export const hasRole = (
	user: AuthenticatedUser | null | undefined,
	...roles: OidcRole[]
): boolean => {
	const held: unknown = (user as { roles?: unknown } | null | undefined)?.[
		ROLES_FIELD
	];

	return Array.isArray(held) && roles.some((role) => held.includes(role));
};

/**
 * An access function granting the request when its user holds at least one of
 * the roles: `access: { update: requireRole("editor", "admin") }`.
 */
export const requireRole =
	(...roles: OidcRole[]): Access =>
	({ req }) =>
		hasRole(req.user, ...roles);
