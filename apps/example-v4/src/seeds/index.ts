import { pagesSeed } from "./pages";
import { postsSeed } from "./posts";
import { siteSettingsSeed } from "./settings";
import { tagsSeed, usersSeed } from "./taxonomy";

import type { DummySeed } from "@abinnovision/payloadcms-dummy";

/** Declared in reading order; the runner sorts them by `dependsOn`. */
export const seeds: readonly DummySeed[] = [
	usersSeed,
	tagsSeed,
	postsSeed,
	pagesSeed,
	siteSettingsSeed,
];
