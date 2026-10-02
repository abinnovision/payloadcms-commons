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
