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
		resolvedFeatureMap?: Map<
			string,
			{ clientFeatureProps?: unknown; sanitizedServerFeatureProps?: unknown }
		>;
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

/**
 * Values a feature restricts a node property to, keyed by node type and then by
 * the property on the node that carries the value.
 */
type NodeOptions = Record<string, Record<string, string[]>>;

/**
 * One node property a feature narrows, and where its setting is configured.
 *
 * `defaults` is what the feature falls back to, because a feature added without
 * arguments records nothing: the default lives in the feature's own
 * destructuring and never reaches its props.
 */
interface NodeOptionSource {
	defaults: readonly string[];
	featureKey: string;
	featureProp: string;
	nodeProp: string;
	nodeType: string;
}

/**
 * Node properties worth reporting and enforcing.
 *
 * Only properties a feature narrows and Lexical does not check on its own
 * belong here. Everything else a feature restricts is already visible: a
 * link's targets through its sub-schema, a block node's choices through the
 * slugs it accepts.
 */
const NODE_OPTION_SOURCES: readonly NodeOptionSource[] = [
	{
		defaults: ["h1", "h2", "h3", "h4", "h5", "h6"],
		featureKey: "heading",
		featureProp: "enabledHeadingSizes",
		nodeProp: "tag",
		nodeType: "heading",
	},
];

/**
 * The props a feature was resolved with.
 *
 * Sanitizing the editor drops every feature's props from `editorConfig.features`
 * but leaves them on `resolvedFeatureMap`. A feature that declares no server
 * props keeps only the client ones, so both are tried.
 */
const featurePropsOf = (
	field: RichTextField,
	featureKey: string,
): Record<string, unknown> | undefined => {
	const resolved = (
		field.editor as LexicalLikeEditor | undefined
	)?.editorConfig?.resolvedFeatureMap?.get(featureKey);

	const props =
		resolved?.sanitizedServerFeatureProps ?? resolved?.clientFeatureProps;

	return typeof props === "object" && props !== null
		? (props as Record<string, unknown>)
		: undefined;
};

const stringList = (value: unknown): string[] | undefined =>
	Array.isArray(value) &&
	value.every((entry): entry is string => typeof entry === "string")
		? value
		: undefined;

/**
 * The narrowed node properties of a rich text field, for the node types it
 * actually accepts.
 */
const nodeOptions = (
	field: RichTextField,
	allowed: readonly string[],
): NodeOptions | undefined => {
	const entries = NODE_OPTION_SOURCES.flatMap((source) => {
		if (!allowed.includes(source.nodeType)) {
			return [];
		}

		const values = stringList(
			featurePropsOf(field, source.featureKey)?.[source.featureProp],
		) ?? [...source.defaults];

		return [[source.nodeType, { [source.nodeProp]: values }] as const];
	});

	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

export { allowedNodeTypes, lexicalSubSchema, nodeOptions, subSchemaNodeTypes };
export type { NodeOptions };
