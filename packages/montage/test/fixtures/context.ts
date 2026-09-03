import { createContextExtension } from "../../src/context.js";

/**
 * Stand-in for a consumer's own render-context shape, shaped to exercise the
 * patterns the acceptance set falsifies: `document` for ctx-only predicates,
 * `isPreview` for cross-cutting visibility.
 */
export interface AppContext {
	document: {
		collection: string;
		identifier: { field: string; value: string };
	};
	locale: "de" | "en";
	isPreview: boolean;
	path: string;
}

/** A parent-to-child signal for whether a section is the first one on the page. */
export const isFirstSection = createContextExtension<boolean>(
	"app:is-first-section",
);
