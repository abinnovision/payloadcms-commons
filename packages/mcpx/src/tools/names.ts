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

export { BUILTIN_TOOL_NAMES };
