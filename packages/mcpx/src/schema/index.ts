export { addressesAdminHidden, stripAdminHidden } from "./admin-hidden.js";
export {
	nodeDescriber,
	reachableSchemaPaths,
	REACHABLE_PATHS_LIMIT,
} from "./describe.js";
export { SchemaError } from "./errors.js";
export { editorRoot, nodePropertiesFor } from "./lexical.js";
export { lexicalOutline } from "./outline.js";
export {
	isIndexSegment,
	JSON_POINTER_PATTERN,
	parentPointer,
	pointerFromPayloadPath,
	prototypeSegmentProblem,
	splitPath,
} from "./path.js";
export { resolveDataPointer } from "./pointer.js";
export type { PointerResolution } from "./pointer.js";
export { EMPTY_ROOT, validateWriteValue } from "./shape.js";
export {
	blockRows,
	classifyKey,
	descriptorsUnder,
	findFieldAt,
	RESERVED_FIELD_NAMES,
	ROW_KEYS,
} from "./walk.js";
