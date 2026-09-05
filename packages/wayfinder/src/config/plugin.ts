import { createMappingGlobal } from "./mapping-global.js";
import { wayfinderTranslations } from "./translations.js";

import type { CreateMappingGlobalArgs } from "./mapping-global.js";
import type { Config, Plugin } from "payload";

export interface WayfinderPluginArgs extends CreateMappingGlobalArgs {
	/**
	 * Collections that can be linked to. Only used to warn about missing
	 * `defaultPopulate`; linking itself is governed by the link field.
	 */
	linkableCollections?: string[];
	/**
	 * Set when the project resolves references through its own index rather
	 * than a populated document. Suppresses the `defaultPopulate` warning,
	 * which would otherwise be noise for a deliberately depth-capped setup.
	 */
	resolvesReferencesExternally?: boolean;
	/** Silences the startup checks. */
	quiet?: boolean;
}

/**
 * Registers the mapping global and the package's admin translations.
 *
 * The single place the global's slug and localization are decided, so the
 * write side and the read side cannot drift apart — `loadMappings` has to be
 * told the same two things, and a mismatch means writing to one global and
 * reading from another.
 *
 * @param args Mapping-global settings and startup-check inputs.
 */
export const wayfinderPlugin =
	(args: WayfinderPluginArgs = {}): Plugin =>
	(incoming: Config): Config => {
		const config: Config = {
			...incoming,
			globals: [...(incoming.globals ?? []), createMappingGlobal(args)],
			i18n: {
				...incoming.i18n,
				translations: {
					...incoming.i18n?.translations,
					...wayfinderTranslations,
				},
			},
		};

		if (args.quiet) {
			return config;
		}

		/*
		 * A reference resolves off the populated document, so a linkable
		 * collection without `defaultPopulate` produces links that work at
		 * high query depth and silently vanish at low depth. Saying so once at
		 * boot is cheaper than finding it in a footer.
		 */
		if (!args.resolvesReferencesExternally) {
			const missing = (args.linkableCollections ?? []).filter((slug) => {
				const collection = config.collections?.find((it) => it.slug === slug);

				return collection && !collection.defaultPopulate;
			});

			if (missing.length > 0) {
				console.warn(
					`[wayfinder] Linkable collections without \`defaultPopulate\`: ${missing.join(", ")}. Links to them break whenever the query depth runs out before the relationship is populated.`,
				);
			}
		}

		return config;
	};
