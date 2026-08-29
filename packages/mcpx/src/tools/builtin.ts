import { createDocument } from "./create-document.js";
import { describeSchema } from "./describe-schema.js";
import { findDocuments } from "./find-documents.js";
import { getDocument } from "./get-document.js";
import { listCapabilities } from "./list-capabilities.js";
import { patchDocument } from "./patch-document.js";
import { publishDocument } from "./publish-document.js";
import { validateDocument } from "./validate-document.js";

import type { McpxAnyTool } from "../types.js";

/**
 * The builtin tools, in registration order. Fixed: adding a collection, block
 * or field never changes the surface. They differ from a custom tool only in
 * `isEnabled`, which derives from the key's capabilities rather than a
 * checkbox of their own.
 */
export const BUILTIN_TOOLS: McpxAnyTool[] = [
	listCapabilities,
	describeSchema,
	findDocuments,
	getDocument,
	patchDocument,
	createDocument,
	validateDocument,
	publishDocument,
];
