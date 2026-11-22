import { FILE_THREAD_FIELD } from "./collection.js";
import { ownerWhere } from "../threads/owner.js";
import { flueTokenThread } from "../tokens/strategy.js";

import type { NormalizedOptions } from "../options.js";
import type { Access, PayloadRequest, Where } from "payload";

/** Where the plugin leaves what {@link flueThreadScoped} reads, on `config.custom`. */
export const SCOPE_SETTINGS_KEY = "@abinnovision/payloadcms-flue/scope";

/** What {@link flueThreadScoped} reads from the sanitized config. */
export interface ScopeSettings {
	mcpx: Pick<NormalizedOptions["mcpx"], "userCollection">;
	/** The files collection, which has the `flueThread` field; `false` with files off. */
	files: false | string;
}

const settingsOf = (req: PayloadRequest): ScopeSettings | undefined =>
	req.payload.config.custom[SCOPE_SETTINGS_KEY] as ScopeSettings | undefined;

// The files `req.user` created; refuses everything without the plugin's settings.
const ownFiles: Access = ({ req }) => {
	const settings = settingsOf(req);

	return settings ? ownerWhere(req, settings.mcpx.userCollection) : false;
};

/**
 * Keeps agents to the files of their current thread. Put it on the
 * `files.collection`'s `access.read`, which versions inherit unless the
 * collection sets its own `readVersions`, and on `update` and `delete`
 * where agents may write; not on `create`. Requests authenticated by an
 * agent token, over mcpx or REST, get `access`'s result narrowed to the
 * token's thread, and nothing on another collection; every other request
 * gets `access`'s result unchanged.
 * `access` defaults to the files the requesting user created, for users
 * of mcpx's user collection only.
 */
export const flueThreadScoped =
	(access: Access = ownFiles): Access =>
	async (args) => {
		const base = await access(args);

		if (!base) {
			return false;
		}

		const scope = flueTokenThread(args.req);

		if (scope === undefined) {
			return base;
		}

		if (args.slug !== settingsOf(args.req)?.files) {
			return false;
		}

		const own: Where = { [FILE_THREAD_FIELD]: { equals: scope } };

		return base === true ? own : { and: [base, own] };
	};
