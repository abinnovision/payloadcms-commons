import type { Block, Plugin } from "payload";

/**
 * Registers `blocks` in `config.blocks`, additively. This is the only thing
 * the plugin does: it does not add collections or globals (those must land
 * in the consumer's own arrays, so plugins like import/export or search that
 * are configured from those arrays can see them), and it does not inject
 * fields into consumer-owned collections.
 */
export const montagePlugin = (args: { blocks: Block[] }): Plugin => {
	const plugin: Plugin = (config) => {
		return {
			...config,
			blocks: [...(config.blocks ?? []), ...args.blocks],
		};
	};

	plugin.slug = "montage";

	return plugin;
};
