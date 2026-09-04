import type { Block, Plugin } from "payload";

/**
 * Describes every slug appearing more than once across the merged
 * `config.blocks`, naming which side each occurrence came from so the message
 * points at the registration to remove.
 */
const describeDuplicateSlugs = (
	existing: Block[],
	added: Block[],
): string[] => {
	const counts = new Map<string, { added: number; existing: number }>();

	const tally = (blocks: Block[], side: "added" | "existing"): void => {
		for (const { slug } of blocks) {
			const entry = counts.get(slug) ?? { added: 0, existing: 0 };
			entry[side] += 1;
			counts.set(slug, entry);
		}
	};

	tally(existing, "existing");
	tally(added, "added");

	return [...counts.entries()]
		.filter(([, n]) => n.added + n.existing > 1)
		.map(([slug, n]) => {
			const sides = [
				n.existing > 0 ? `${String(n.existing)} already in config.blocks` : "",
				n.added > 0 ? `${String(n.added)} passed to montagePlugin` : "",
			].filter((side) => side !== "");

			return `"${slug}" (${sides.join(", ")})`;
		});
};

/**
 * Registers `blocks` in `config.blocks`, additively. This is the only thing
 * the plugin does: it does not add collections or globals (those must land
 * in the consumer's own arrays, so plugins like import/export or search that
 * are configured from those arrays can see them), and it does not inject
 * fields into consumer-owned collections.
 *
 * It does reject duplicate slugs in the merged result. Payload does not
 * deduplicate `config.blocks`, and the two consumers of that array disagree
 * about which duplicate wins: a slug reference resolves to the first match,
 * while a generated interface is keyed by the last. A duplicate therefore
 * produces a schema and a type that describe different blocks. This merge is
 * where a consumer's own blocks meet montage's, so it is the likeliest place
 * for that collision to appear.
 */
export const montagePlugin = (args: { blocks: Block[] }): Plugin => {
	const plugin: Plugin = (config) => {
		const existing = config.blocks ?? [];
		const duplicates = describeDuplicateSlugs(existing, args.blocks);

		if (duplicates.length > 0) {
			throw new Error(
				`montage: duplicate block slug${duplicates.length > 1 ? "s" : ""} in config.blocks: ${duplicates.join("; ")}. ` +
					"Payload resolves a slug reference to the first match but keys generated interfaces by the last, " +
					"so a duplicate produces a schema and a type that disagree. Remove the extra registration.",
			);
		}

		return {
			...config,
			blocks: [...existing, ...args.blocks],
		};
	};

	plugin.slug = "montage";

	return plugin;
};
