import { paragraph } from "./lexical.js";

/** A hero module block, as stored in a section wrapper's `modules`. */
export const hero = (title: string): Record<string, unknown> => ({
	blockType: "hero",
	title: paragraph(title),
});

/** A section wrapper block holding the given modules. */
export const section = (
	identifier: string,
	modules: Record<string, unknown>[] = [],
): Record<string, unknown> => ({
	blockType: "sectionWrapper",
	identifier,
	modules,
});
