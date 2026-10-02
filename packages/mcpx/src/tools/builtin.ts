import { createDocument } from "./create-document.js";
import { describeSchema } from "./describe-schema.js";
import { findDocuments } from "./find-documents.js";
import { findVersions } from "./find-versions.js";
import { getDocument } from "./get-document.js";
import { listCapabilities } from "./list-capabilities.js";
import { patchDocument } from "./patch-document.js";
import { publishDocument } from "./publish-document.js";
import { validateDocument } from "./validate-document.js";

import type { McpxAnyTool } from "../types.js";

/**
 * The builtin tools, in registration order. The set is fixed, so adding a
 * collection, block or field never changes it. They differ from custom tools
 * only in `isEnabled`, which derives from the key's capabilities instead of a
 * checkbox of its own.
 */
export const BUILTIN_TOOLS: McpxAnyTool[] = [
	listCapabilities,
	describeSchema,
	findDocuments,
	getDocument,
	findVersions,
	patchDocument,
	createDocument,
	validateDocument,
	publishDocument,
];
