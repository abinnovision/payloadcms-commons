/**
 * Names of the builtin tools. Custom tools must not reuse them.
 */
export const BUILTIN_TOOL_NAMES = [
	"listCapabilities",
	"describeSchema",
	"findDocuments",
	"getDocument",
	"patchDocument",
	"createDocument",
	"validateDocument",
	"publishDocument",
] as const;
