export const JSON_POINTER_PATTERN = /^(\/([^~/]|~[01])*)*$/;

/** No segments is the root pointer, `""`. */
export const joinPath = (parts: readonly string[]): string =>
	parts
		.map((part) => `/${part.replace(/~/g, "~0").replace(/\//g, "~1")}`)
		.join("");

/** Unescapes `~1` and `~0`. The root pointer yields no segments. */
export const splitPath = (path: string): string[] =>
	path
		.split("/")
		.slice(1)
		.map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

const PROTOTYPE_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * No field or node property has one of these names. rfc6902 skips them as
 * intermediate tokens but writes them as a final key, so a pointer containing
 * one is refused before anything resolves it.
 */
export const prototypeSegmentProblem = (pointer: string): string | undefined =>
	splitPath(pointer).some((segment) => PROTOTYPE_SEGMENTS.has(segment))
		? `"${pointer}" contains a segment named __proto__, constructor or prototype, which no field or node property uses.`
		: undefined;

/** `-` included, since RFC 6901 reads it as the position after the last. */
export const isIndexSegment = (segment: string): boolean =>
	segment === "-" || /^\d+$/.test(segment);

/**
 * A path Payload reports on a validation error (`layout.0.title`) as a JSON
 * Pointer, so everything handed back addresses documents the same way. The
 * path already carries real indices, so it maps directly.
 */
export const pointerFromPayloadPath = (path: string): string =>
	path ? joinPath(path.split(".")) : "";
