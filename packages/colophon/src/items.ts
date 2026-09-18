import { shortSha } from "./format.js";

import type { LabelLike } from "./labels.js";

/** One row in the sidebar group. */
export interface ColophonItem {
	/** Stable key. Identifies the row in React and in the duplicate-key error. */
	key: string;
	/** Row label. A record is resolved against the admin language. Defaults to `key`. */
	label?: LabelLike | undefined;
	/**
	 * Environment variable names, tried in order. The first one that is set to
	 * a non-empty value wins.
	 */
	env?: string[] | undefined;
	/** Used when no name in `env` is set. A row that resolves to nothing is dropped. */
	fallback?: string | undefined;
	/**
	 * Computes the value outright, ahead of `env` and `fallback`.
	 *
	 * Runs on every admin render and is not memoized, so it has to be pure and
	 * cheap. Anything that needs real work belongs in `fallback`, computed once
	 * where the Payload config is built.
	 */
	value?: (() => string | undefined) | undefined;
	/** Last transform before display, e.g. shortening a commit sha. */
	format?: ((value: string) => string) | undefined;
}

/** A row that resolved to something worth rendering. */
export interface ResolvedColophonItem {
	key: string;
	label: LabelLike;
	/** What the row shows, after `format`. */
	display: string;
	/** What `format` was given, kept for the row's tooltip. */
	full: string;
}

/**
 * The rows a project gets without configuring any.
 *
 * `APP_*` is the name this package documents. `BUILD_*` follows it so an app
 * that already sets those from its CI keeps working without touching its
 * deployment.
 *
 * Every name here has to be one somebody set on purpose. `NODE_ENV` and
 * `npm_package_version` are deliberately absent for that reason: the runtime
 * sets both no matter what, so including them would put an "Environment:
 * production" and a version nobody deployed into the sidebar of every app
 * that installed this plugin and configured nothing. In a monorepo
 * `npm_package_version` is the workspace's own version, which is not the
 * build either.
 *
 * Deliberately no CI-provider detection. Every provider names these
 * differently, the list would never be complete, and adding one is a single
 * entry in `env` for the project that needs it.
 */
export const defaultColophonItems: ColophonItem[] = [
	{
		key: "version",
		label: "Version",
		env: ["APP_VERSION", "BUILD_VERSION"],
	},
	{
		key: "commit",
		label: "Commit",
		env: ["APP_COMMIT", "BUILD_COMMIT", "GIT_COMMIT_SHA"],
		format: shortSha,
	},
	{
		key: "environment",
		label: "Environment",
		env: ["APP_ENVIRONMENT", "BUILD_ENVIRONMENT"],
	},
];

/**
 * Validates the configured rows and fills in the label default.
 *
 * Runs once, where the plugin is applied, so a mistake surfaces at boot rather
 * than as a missing row somebody notices weeks later.
 *
 * @throws If two rows share a key, which would collide as a React key and
 *   leave one of the two silently unrendered.
 */
export const normalizeItems = (items: ColophonItem[]): ColophonItem[] => {
	const seen = new Set<string>();

	return items.map((item) => {
		if (item.key === "") {
			throw new Error("[payloadcms-colophon] An item key may not be empty.");
		}

		if (seen.has(item.key)) {
			throw new Error(
				`[payloadcms-colophon] Duplicate item key "${item.key}". Each item needs its own key.`,
			);
		}

		seen.add(item.key);

		return { ...item, label: item.label ?? item.key };
	});
};

/**
 * Reads one row's value.
 *
 * An environment variable set to the empty string counts as unset. A container
 * that declares a variable it has no value for is the normal way this happens,
 * and a row showing nothing is worse than no row.
 */
const readValue = (item: ColophonItem): string | undefined => {
	const computed = item.value?.();
	if (computed !== undefined && computed !== "") {
		return computed;
	}

	for (const name of item.env ?? []) {
		const fromEnv = process.env[name];
		if (fromEnv !== undefined && fromEnv !== "") {
			return fromEnv;
		}
	}

	return item.fallback !== undefined && item.fallback !== ""
		? item.fallback
		: undefined;
};

/** Reported when a row's own functions throw, so one bad row is diagnosable. */
export type ColophonWarn = (message: string, error: unknown) => void;

/**
 * Resolves every row against the current environment.
 *
 * Rows that resolve to nothing are dropped rather than rendered as "unknown":
 * the group is a statement of what this build is, and a row nobody configured
 * says nothing.
 *
 * Each row is resolved in isolation. `value` and `format` are consumer code
 * running inside the admin's navigation, and one of them throwing must cost
 * its own row and nothing else.
 */
export const resolveItems = (
	items: ColophonItem[],
	warn?: ColophonWarn,
): ResolvedColophonItem[] => {
	const resolved: ResolvedColophonItem[] = [];

	for (const item of items) {
		try {
			const full = readValue(item);
			if (full === undefined) {
				continue;
			}

			resolved.push({
				key: item.key,
				label: item.label ?? item.key,
				display: item.format?.(full) ?? full,
				full,
			});
		} catch (error) {
			warn?.(
				`[payloadcms-colophon] Item "${item.key}" failed to resolve and was skipped.`,
				error,
			);
		}
	}

	return resolved;
};
