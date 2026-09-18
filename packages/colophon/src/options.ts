import type { ColophonItem } from "./items.js";
import type { LabelLike } from "./labels.js";

/**
 * The shape the plugin parks on the Payload config and the component reads
 * back off the running instance.
 *
 * It holds functions, which is why it goes on the server-only `custom`
 * extension point rather than `admin.custom`: the latter is copied into the
 * client config and would have to survive serialization.
 */
export interface ColophonOptions {
	items: ColophonItem[];
	label: LabelLike;
	open: boolean;
	condition?: ((args: ColophonConditionArgs) => boolean) | undefined;
}

/** What `condition` gets to decide on. */
export interface ColophonConditionArgs {
	/** The signed-in admin user, absent only before login. */
	user?: { [key: string]: unknown } | undefined;
}

/**
 * The key under `config.custom` this package owns, and the component's import
 * path. Both are shared between the config half and the admin half, and both
 * are the kind of string that breaks silently when it drifts.
 */
export const COLOPHON_CUSTOM_KEY = "colophon";

/**
 * Payload resolves admin components by import path, so this string has to
 * match the `./admin` export. Consumers must run
 * `payload generate:importmap` after adding the plugin, as for any plugin
 * that contributes admin components.
 */
export const COLOPHON_COMPONENT =
	"@abinnovision/payloadcms-colophon/admin#Colophon";

/** The group's label when a project does not name it. */
export const DEFAULT_COLOPHON_LABEL = "System";

/**
 * Reads the options back off a running Payload config.
 *
 * Typed as `unknown` in, because `custom` is `Record<string, any>` on Payload's
 * side and the component has no way to prove what a project put there.
 */
export const readColophonOptions = (
	custom: unknown,
): ColophonOptions | undefined => {
	if (typeof custom !== "object" || custom === null) {
		return undefined;
	}

	const parked = (custom as Record<string, unknown>)[COLOPHON_CUSTOM_KEY];

	return typeof parked === "object" && parked !== null
		? (parked as ColophonOptions)
		: undefined;
};
