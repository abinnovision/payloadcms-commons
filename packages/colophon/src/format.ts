/**
 * A commit sha is the one value here that is both too long for the sidebar and
 * meaningful when cut: the first seven characters are what every git UI shows
 * and what an editor would paste into a search box.
 */
const SHA_RE = /^[\da-f]{7,}$/i;

/** How many characters git itself abbreviates a sha to by default. */
const SHORT_LENGTH = 7;

/**
 * Shortens a commit sha, leaving anything that is not one untouched.
 *
 * The guard matters because the same item is often pointed at a variable that
 * holds a tag on release builds and a sha on everything else. Truncating
 * blindly would turn `v1.12.30` into `v1.12.3`, which is a different version
 * that also exists.
 */
export const shortSha = (value: string): string =>
	SHA_RE.test(value) ? value.slice(0, SHORT_LENGTH) : value;
