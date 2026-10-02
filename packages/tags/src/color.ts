/**
 * A dozen hues, spread far enough apart that adjacent presets stay
 * distinguishable in a chip and still read as one family in a list.
 */
export const PRESETS: readonly string[] = [
	"#ef4444",
	"#f97316",
	"#f59e0b",
	"#84cc16",
	"#22c55e",
	"#14b8a6",
	"#06b6d4",
	"#3b82f6",
	"#6366f1",
	"#8b5cf6",
	"#ec4899",
	"#64748b",
];

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Any hex color is accepted, not just the presets: a project may already have
 * brand colors it wants its tags to carry.
 */
export const isHexColor = (value: unknown): value is string =>
	typeof value === "string" && HEX_RE.test(value);

/**
 * Picks a preset deterministically from a tag's title, so a tag created
 * without an explicit color gets a stable one rather than a random seed that
 * would make tests and re-renders disagree.
 */
export const colorForName = (name: string): string => {
	let hash = 0;
	for (let index = 0; index < name.length; index += 1) {
		hash = (hash * 31 + name.charCodeAt(index)) | 0;
	}

	const preset = PRESETS[Math.abs(hash) % PRESETS.length];

	// `PRESETS` is non-empty and the index is reduced modulo its length.
	return preset as string;
};
