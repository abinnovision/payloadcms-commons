/**
 * The shared layer: color handling, client-side search and selection, the
 * permission check and the list-cell model.
 *
 * Reached from both halves of the package: `./config` builds the field and
 * hook components where the Payload config is built, `./admin` renders them
 * where the form and the lists render, so it stays free of React and of the
 * Payload runtime alike.
 */
export { PRESETS, colorForName, isHexColor } from "./color.js";
export { matchesTag } from "./search.js";
export { resolveSelection } from "./selection.js";
export { canInlineCreate } from "./permissions.js";
export { normalizeCellValues } from "./cell.js";
export {
	COLOR_FIELD_COMPONENT,
	TAGS_CELL_COMPONENT,
	TAGS_FIELD_COMPONENT,
	TAG_TITLE_CELL_COMPONENT,
} from "./options.js";

export type { CellRelationshipValue, CellTag, NormalizedCell } from "./cell.js";
export type {
	TagsCollectionPermissions,
	TagsPermissions,
} from "./permissions.js";
export type {
	SelectionInput,
	SelectionResult,
	TagOption,
} from "./selection.js";
export type {
	ColorFieldClientProps,
	TagsCellClientProps,
	TagsFieldClientProps,
} from "./options.js";
