import {
	COLOPHON_COMPONENT,
	COLOPHON_CUSTOM_KEY,
	DEFAULT_COLOPHON_LABEL,
	defaultColophonItems,
	normalizeItems,
} from "../index.js";

import type {
	ColophonConditionArgs,
	ColophonItem,
	ColophonOptions,
	LabelLike,
} from "../index.js";
import type { Config, Plugin } from "payload";

const append = (existing: unknown[] | undefined): string[] | undefined => {
	const components = (existing ?? []) as string[];

	return components.includes(COLOPHON_COMPONENT)
		? undefined
		: [...components, COLOPHON_COMPONENT];
};

export interface ColophonPluginArgs {
	/**
	 * Replaces the default rows. Spread `defaultColophonItems` to keep them:
	 * `items: [...defaultColophonItems, { key: "region", env: ["APP_REGION"] }]`.
	 */
	items?: ColophonItem[] | undefined;

	/**
	 * Group label. Defaults to `"System"`.
	 */
	label?: LabelLike | undefined;

	/**
	 * Start the group expanded. Defaults to collapsed, as a footer should be.
	 */
	open?: boolean | undefined;

	/**
	 * Hides the whole group when it returns false. Defaults to always visible.
	 */
	condition?: ((args: ColophonConditionArgs) => boolean) | undefined;
}

/**
 * Shows system metadata at the foot of the admin sidebar.
 *
 * Values are read from the environment of the running process each time the
 * admin renders, not inlined at build time, so one image redeployed with a new
 * `APP_VERSION` reports the new version without being rebuilt.
 *
 * The options are parked on the config's server-only `custom` extension point
 * rather than passed as component props, because the component is resolved by
 * import path and cannot be closed over, and because `items` holds functions
 * that `admin.custom` would have to serialize to the client.
 */
export const colophonPlugin = (args: ColophonPluginArgs = {}): Plugin => {
	const options: ColophonOptions = {
		items: normalizeItems(args.items ?? defaultColophonItems),
		label: args.label ?? DEFAULT_COLOPHON_LABEL,
		open: args.open ?? false,
		...(args.condition ? { condition: args.condition } : {}),
	};

	const plugin: Plugin = (config: Config): Config => {
		const afterNavLinks = append(config.admin?.components?.afterNavLinks);

		return {
			...config,
			custom: { ...config.custom, [COLOPHON_CUSTOM_KEY]: options },
			admin: {
				...config.admin,
				components: {
					...config.admin?.components,
					...(afterNavLinks ? { afterNavLinks } : {}),
				},
			},
		};
	};

	plugin.slug = "colophon";

	return plugin;
};
