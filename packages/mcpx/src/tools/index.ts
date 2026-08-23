import { createDocument } from "./create-document.js";
import { describeSchema } from "./describe-schema.js";
import { findDocuments } from "./find-documents.js";
import { getDocument } from "./get-document.js";
import { listCapabilities } from "./list-capabilities.js";
import { patchDocument } from "./patch-document.js";
import { validateDocument } from "./validate-document.js";

import type { BuiltinTool } from "./types.js";

/**
 * The builtin tools in registration order. The surface is fixed: adding a
 * collection, block or field never changes it. Typed over `never` because
 * each tool validates its own arguments through its input schema.
 */
const BUILTIN_TOOLS: BuiltinTool<never>[] = [
	listCapabilities,
	describeSchema,
	findDocuments,
	getDocument,
	patchDocument,
	createDocument,
	validateDocument,
];

export { BUILTIN_TOOLS };
