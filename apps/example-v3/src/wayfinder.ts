import { loadMappings } from "@abinnovision/payloadcms-wayfinder/config";
import config from "@payload-config";
import { getPayload } from "payload";
import { cache } from "react";

import { links } from "./links";
import { createFormatHref } from "./locales";

import type { CreateRouterArgs } from "@abinnovision/payloadcms-wayfinder";
import type { TypedLocale } from "payload";

/**
 * Reads the collection mapping once per request.
 *
 * `loadMappings` memoises pattern compilation but always performs the read, so
 * the request-scoped memo is the app's job. Wrapping it here means the
 * catch-all, its metadata pass, the sitemap and the preview route share one
 * query even though none of them knows about the others.
 *
 * Nothing is passed but the instance. Whether patterns are per-locale is
 * derived from the same `localization` block `payload.config.ts` declares, so
 * there is no second copy of that decision to keep in step.
 */
const getMappings = cache(async () => {
	const payload = await getPayload({ config });

	return await loadMappings({ payload });
});

/**
 * Everything a router needs, for one locale.
 *
 * The single place this app decides what a wayfinder router is made of, so a
 * caller cannot build one with the mappings but without the href formatter and
 * quietly emit unprefixed URLs.
 */
export const routerArgs = async (
	locale: TypedLocale,
): Promise<CreateRouterArgs<typeof links>> => ({
	mappings: await getMappings(),
	locale,
	formatHref: createFormatHref(),
	links,
	context: { filesBase: "/files" },
});
