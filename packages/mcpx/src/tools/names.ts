/**
 * Names of the builtin tools. Custom tools must not reuse them.
 */
const BUILTIN_TOOL_NAMES = [
	"listCapabilities",
	"describeSchema",
	"findDocuments",
	"getDocument",
	"patchDocument",
	"createDocument",
	"validateDocument",
] as const;

type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export { BUILTIN_TOOL_NAMES };
export type { BuiltinToolName };
