import { articlesSeed } from "./articles";
import { pagesSeed } from "./pages";
import { postsSeed } from "./posts";
import { mappingSeed, siteSettingsSeed } from "./settings";
import { sectionsSeed, tagsSeed, usersSeed } from "./taxonomy";

import type { DummySeed } from "@abinnovision/payloadcms-dummy";

/** Declared in reading order; the runner sorts them by `dependsOn`. */
export const seeds: readonly DummySeed[] = [
	usersSeed,
	tagsSeed,
	sectionsSeed,
	postsSeed,
	articlesSeed,
	pagesSeed,
	siteSettingsSeed,
	mappingSeed,
];
