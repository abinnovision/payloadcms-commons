import { flattenAllFields } from "payload";

import type {
	Field,
	FlattenedBlocksField,
	FlattenedField,
	RichTextField,
} from "payload";

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
 * Node types whose sub-fields exist but cannot be addressed by a schema path.
 *
 * Asked without a node, `upload` answers with every enabled collection's
 * upload fields concatenated, so the result describes no single position. It
 * would need addressing by `relationTo` to mean anything.
 */
const OPAQUE_NODE_TYPES: ReadonlySet<string> = new Set(["upload"]);

/**
 * The part of the sanitized Lexical adapter this module reads. Typed
 * structurally so the plugin does not depend on `@payloadcms/richtext-lexical`.
 *
 * `getSubFields` is the hook Payload uses to populate and run hooks on the
 * fields a node carries. Called without a node it returns every sub-field the
 * node can hold, which is exactly a schema. It is keyed by node type and fed
 * by any feature that declares one, so custom features need no special case.
 */
interface LexicalLikeEditor {
	editorConfig?: {
		features?: {
			getSubFields?: Map<
				string,
				(args: { node?: unknown }) => Field[] | null | undefined
			>;
			nodes?: { node?: { getType?: () => string } }[];
		};
	};
}

/**
 * What sits behind one node type.
 *
 * `blocks` covers nodes that pick a definition by slug, which is how the
 * Lexical block features report themselves; the walkers then treat it exactly
 * like a Payload blocks field. `fields` covers everything else, a link node
 * being the common case.
 */
type LexicalSubSchema =
	| { blocksField: FlattenedBlocksField; kind: "blocks" }
	| { fields: FlattenedField[]; kind: "fields" };

/**
 * Sub-schemas per rich text field, keyed by node type. `null` records a node
 * type that was asked and has nothing to describe, so it is asked only once.
 *
 * Worth caching because the describe and validate paths resolve the same field
 * repeatedly, and because the block features build their answer from scratch on
 * every call. Keyed weakly on the sanitized field, which lives as long as the
 * config does.
 */
const subSchemaCache = new WeakMap<
	RichTextField,
	Map<string, LexicalSubSchema | null>
>();

const featuresOf = (field: RichTextField) =>
	(field.editor as LexicalLikeEditor | undefined)?.editorConfig?.features;

/**
 * Node types a rich text field accepts. Editors other than Lexical report
 * only the core nodes.
 */
const allowedNodeTypes = (field: RichTextField): string[] => {
	const registered = (featuresOf(field)?.nodes ?? []).flatMap((entry) => {
		const type = entry.node?.getType?.();

		return type ? [type] : [];
	});

	return [...new Set([...LEXICAL_CORE_NODES, ...registered])];
};

const resolveSubSchema = (
	field: RichTextField,
	nodeType: string,
): LexicalSubSchema | null => {
	if (OPAQUE_NODE_TYPES.has(nodeType)) {
		return null;
	}

	const fields = featuresOf(field)?.getSubFields?.get(nodeType)?.({});

	if (!fields?.length) {
		return null;
	}

	const flattened = flattenAllFields({ fields });
	const only = flattened.length === 1 ? flattened[0] : undefined;

	return only?.type === "blocks"
		? { blocksField: only, kind: "blocks" }
		: { fields: flattened, kind: "fields" };
};

/**
 * The sub-schema behind one node type of a rich text field, or `undefined`
 * when that node carries no addressable fields.
 */
const lexicalSubSchema = (
	field: RichTextField,
	nodeType: string,
): LexicalSubSchema | undefined => {
	let cached = subSchemaCache.get(field);

	if (!cached) {
		cached = new Map();
		subSchemaCache.set(field, cached);
	}

	if (!cached.has(nodeType)) {
		cached.set(nodeType, resolveSubSchema(field, nodeType));
	}

	return cached.get(nodeType) ?? undefined;
};

/**
 * Node types of a rich text field that have a sub-schema, in the order their
 * features registered them.
 */
const subSchemaNodeTypes = (field: RichTextField): string[] =>
	[...(featuresOf(field)?.getSubFields?.keys() ?? [])].filter(
		(nodeType) => lexicalSubSchema(field, nodeType) !== undefined,
	);

export { allowedNodeTypes, lexicalSubSchema, subSchemaNodeTypes };
