import { createDocument } from "./create-document.js";
import { describeSchema } from "./describe-schema.js";
import { findDocuments } from "./find-documents.js";
import { getDocument } from "./get-document.js";
import { listCapabilities } from "./list-capabilities.js";
import { patchDocument } from "./patch-document.js";
import { validateDocument } from "./validate-document.js";

import type { McpxAnyTool } from "../types.js";

/**
 * The builtin tools in registration order. They are ordinary {@link McpxTool}s
 * that ship with the plugin and register through the same loop as the tools
 * from `options.tools`; only their `isEnabled` differs, deriving from the
 * key's collection and global capabilities rather than a checkbox of their
 * own. The surface is fixed: adding a collection, block or field never
 * changes it.
 */
const BUILTIN_TOOLS: McpxAnyTool[] = [
	listCapabilities,
	describeSchema,
	findDocuments,
	getDocument,
	patchDocument,
	createDocument,
	validateDocument,
];

export { BUILTIN_TOOLS };
