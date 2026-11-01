import { runDummyCli } from "@abinnovision/payloadcms-dummy/cli";
import config from "@payload-config";
import { getPayload } from "payload";

import { seeds } from "./seeds";
import { naturalKeys } from "./seeds/natural-keys";

/*
 * Written as top-level await rather than a `main()` call: `payload run` stops
 * once the module finishes evaluating, so a floating promise never resumes.
 */
await runDummyCli({
	payload: () => getPayload({ config }),
	seeds,
	naturalKeys,
	/*
	 * Reverse dependency order, so `--fresh` never deletes a document another
	 * one still points at. `users` is absent: a re-run has no business locking
	 * anyone out of /admin.
	 */
	resetCollections: ["pages", "articles", "posts", "sections", "tags"],
});
