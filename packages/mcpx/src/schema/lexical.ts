import type { RichTextField } from "payload";

/**
 * Node types Lexical registers itself.
 *
 * `editorConfig.features.nodes` lists only what a feature contributed, so a
 * field whose editor enables nothing but text formatting reports none at all.
 */
const LEXICAL_CORE_NODES: readonly string[] = [
	"root",
	"paragraph",
	"text",
	"linebreak",
	"tab",
];

/**
 * The part of the sanitized Lexical adapter this module reads. Typed
 * structurally so the plugin does not depend on `@payloadcms/richtext-lexical`.
 */
interface LexicalLikeEditor {
	editorConfig?: {
		features?: {
			nodes?: { node?: { getType?: () => string } }[];
		};
	};
}

/**
 * Node types a rich text field accepts. Editors other than Lexical report
 * only the core nodes.
 */
const allowedNodeTypes = (field: RichTextField): string[] => {
	const editor = field.editor as LexicalLikeEditor | undefined;

	const registered = (editor?.editorConfig?.features?.nodes ?? []).flatMap(
		(entry) => {
			const type = entry.node?.getType?.();

			return type ? [type] : [];
		},
	);

	return [...new Set([...LEXICAL_CORE_NODES, ...registered])];
};

export { allowedNodeTypes };
