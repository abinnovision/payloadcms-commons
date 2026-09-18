/**
 * The shared layer: the item model, the environment resolution and the
 * formatting helpers.
 *
 * Reached from both halves of the package — `./config` normalizes items where
 * the Payload config is built, `./admin` resolves them where the sidebar
 * renders — so it stays free of React and of the Payload runtime alike.
 */
export { shortSha } from "./format.js";
export { defaultColophonItems, normalizeItems, resolveItems } from "./items.js";
export { resolveLabel } from "./labels.js";
export {
	COLOPHON_COMPONENT,
	COLOPHON_CUSTOM_KEY,
	DEFAULT_COLOPHON_LABEL,
	readColophonOptions,
} from "./options.js";

export type {
	ColophonItem,
	ColophonWarn,
	ResolvedColophonItem,
} from "./items.js";
export type { LabelLike } from "./labels.js";
export type { ColophonConditionArgs, ColophonOptions } from "./options.js";
