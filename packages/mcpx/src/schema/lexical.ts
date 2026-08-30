import { flattenAllFields } from "payload";

import type {
	Field,
	FlattenedBlocksField,
	FlattenedField,
	RichTextField,
} from "payload";

/**
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
 * Sub-fields exist but cannot be addressed by a schema path. Asked without a
 * node, `upload` answers with every enabled collection's upload fields
 * concatenated, so the result describes no single position.
 */
const OPAQUE_NODE_TYPES: ReadonlySet<string> = new Set(["upload"]);

/**
 * Typed structurally so the plugin does not depend on
 * `@payloadcms/richtext-lexical`.
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
 * `blocks` covers nodes that pick a definition by slug, which is how the
 * Lexical block features report themselves, so the walkers treat it exactly
 * like a Payload blocks field. `fields` covers everything else, a link node
 * being the common case.
 */
type LexicalSubSchema =
	| { blocksField: FlattenedBlocksField; kind: "blocks" }
	| { fields: FlattenedField[]; kind: "fields" };

/**
 * `null` records a node type that was asked and has nothing to describe, so it
 * is asked only once. Worth caching because describe and validate resolve the
 * same field repeatedly and the block features rebuild their answer every call.
 */
const subSchemaCache = new WeakMap<
	RichTextField,
	Map<string, LexicalSubSchema | null>
>();

const featuresOf = (field: RichTextField) =>
	(field.editor as LexicalLikeEditor | undefined)?.editorConfig?.features;

/** Editors other than Lexical report only the core nodes. */
export const allowedNodeTypes = (field: RichTextField): string[] => {
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

export const lexicalSubSchema = (
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

/** In the order their features registered them. */
export const subSchemaNodeTypes = (field: RichTextField): string[] =>
	[...(featuresOf(field)?.getSubFields?.keys() ?? [])].filter(
		(nodeType) => lexicalSubSchema(field, nodeType) !== undefined,
	);

/**
 * What a serialized property has to be. A name is a kind; `{ is }` pins an
 * exact value, which a node class occasionally demands.
 */
type Constraint = Kind | { is: number | string };

type Kind = keyof typeof KINDS;

/**
 * `direction` carries Payload's own declaration for it, `oneOf` the two
 * directions or null, rather than a looser "string or null".
 */
const KINDS = {
	array: {
		accepts: (value: unknown) => Array.isArray(value),
		needs: "an array",
	},
	direction: {
		accepts: (value: unknown) =>
			value === null || value === "ltr" || value === "rtl",
		needs: '"ltr", "rtl" or null',
	},
	number: {
		accepts: (value: unknown) => typeof value === "number",
		needs: "a number",
	},
	object: {
		accepts: (value: unknown) =>
			typeof value === "object" && value !== null && !Array.isArray(value),
		needs: "an object",
	},
	optionalObject: {
		accepts: (value: unknown) =>
			value === null || (typeof value === "object" && !Array.isArray(value)),
		needs: "an object or null",
	},
	string: {
		accepts: (value: unknown) => typeof value === "string",
		needs: "a string",
	},
} as const;

const accepts = (constraint: Constraint, value: unknown): boolean =>
	typeof constraint === "string"
		? KINDS[constraint].accepts(value)
		: value === constraint.is;

const needs = (constraint: Constraint): string =>
	typeof constraint === "string"
		? KINDS[constraint].needs
		: JSON.stringify(constraint.is);

const ELEMENT_PROPERTIES = {
	children: "array",
	direction: "direction",
	indent: "number",
} as const satisfies Record<string, Constraint>;

/** A text node and everything built on one. */
const TEXT_PROPERTIES = {
	detail: "number",
	format: "number",
	mode: "string",
	style: "string",
	text: "string",
} as const satisfies Record<string, Constraint>;

/**
 * Carried by every node, whatever its type.
 *
 * Aligned with Payload rather than measured: its `outputSchema` declares `type`
 * and `version` required for every node in the tree, and that declaration is
 * what types the field in `payload-types.ts`. Lexical itself hydrates a node
 * without a `version`, or with the wrong kind of one, unchanged - but a
 * consumer reading the document through the generated types has been promised
 * an integer, and `BlockNode.importJSON` migrates on it.
 */
const UNIVERSAL_PROPERTIES = { version: "number" } as const satisfies Record<
	string,
	Constraint
>;

/**
 * The root, as Payload declares it and as an editor exports it: these six
 * properties, these kinds, and nothing else.
 */
export const ROOT_PROPERTIES: Readonly<Record<string, Constraint>> = {
	children: "array",
	direction: "direction",
	format: "string",
	indent: "number",
	type: "string",
	version: "number",
};

/**
 * What a serialized node must carry beyond {@link UNIVERSAL_PROPERTIES}, keyed
 * by node type.
 *
 * Payload stores an editor state without hydrating it, so a node written
 * without these, or with the wrong kind of value, is accepted and only fails
 * later, in the admin editor. Payload declares nothing per node type, so this
 * table is measured instead: an entry belongs here only if breaking it makes
 * Lexical throw, or changes what the editor reads back. An element's `format`
 * and a paragraph's text defaults are absent for that reason.
 * `lexical.spec.ts` holds every entry to the rule against the node classes
 * `@payloadcms/richtext-lexical` ships, so extend that test first.
 *
 * A node type with no entry is checked for the universal properties only.
 * Guessing at the requirements of a project's own nodes would reject content
 * that works.
 */
export const REQUIRED_NODE_PROPERTIES: Readonly<
	Record<string, Readonly<Record<string, Constraint>>>
> = {
	autolink: { ...ELEMENT_PROPERTIES, fields: "object" },
	block: { fields: "object" },
	heading: { ...ELEMENT_PROPERTIES, tag: "string" },
	inlineBlock: { fields: "object" },
	link: { ...ELEMENT_PROPERTIES, fields: "object" },
	list: { ...ELEMENT_PROPERTIES, listType: "string", start: "number" },
	listitem: { ...ELEMENT_PROPERTIES, value: "number" },
	paragraph: ELEMENT_PROPERTIES,
	quote: ELEMENT_PROPERTIES,
	relationship: { relationTo: "string", value: "number" },
	/*
	 * A tab is a text node holding one tab character, and its class refuses to
	 * be told otherwise: both of these are exact because `setDetail` and
	 * `setTextContent` throw for any other value.
	 */
	tab: { ...TEXT_PROPERTIES, detail: { is: 2 }, text: { is: "\t" } },
	text: TEXT_PROPERTIES,
	/*
	 * An upload node's sub-fields depend on the collection it points at and are
	 * not addressable through a schema path, so "fields" is usually written as
	 * null. It is still required: Lexical reads the node back without it.
	 */
	upload: { fields: "optionalObject", relationTo: "string", value: "number" },
};

/**
 * Whether the table already says what a node type's `fields` has to be, so the
 * sub-field walk does not report the same problem a second time.
 */
export const constrainsFields = (type: string): boolean =>
	"fields" in (REQUIRED_NODE_PROPERTIES[type] ?? {});

/**
 * A property that is absent, and one that is present but cannot be what the
 * node class does with it.
 */
export interface PropertyProblems {
	missing: string[];
	rejected: { needs: string; property: string }[];
}

/** Present but `null` counts as present: `direction` is serialized that way. */
const check = (
	node: Record<string, unknown>,
	constraints: Readonly<Record<string, Constraint>>,
): PropertyProblems => {
	const problems: PropertyProblems = { missing: [], rejected: [] };

	for (const [property, constraint] of Object.entries(constraints)) {
		if (!(property in node)) {
			problems.missing.push(property);
		} else if (!accepts(constraint, node[property])) {
			problems.rejected.push({ needs: needs(constraint), property });
		}
	}

	problems.missing.sort();
	problems.rejected.sort((left, right) =>
		left.property.localeCompare(right.property),
	);

	return problems;
};

export const nodeProblems = (node: Record<string, unknown>): PropertyProblems =>
	check(node, {
		...UNIVERSAL_PROPERTIES,
		...(REQUIRED_NODE_PROPERTIES[node["type"] as string] ?? {}),
	});

/**
 * The root is the one node Payload describes itself, down to refusing an
 * unknown property, so it is checked against that description rather than
 * against the walk's table.
 */
export const rootProblems = (
	root: Record<string, unknown>,
): PropertyProblems & { unexpected: string[] } => ({
	...check(root, ROOT_PROPERTIES),
	unexpected: Object.keys(root).filter(
		(property) => !(property in ROOT_PROPERTIES),
	),
});

/**
 * What one serialized property has to be, for a write addressing a property
 * rather than a whole node.
 *
 * Absent where the table says nothing, which is the same tolerance the node
 * walk shows: a project's own node may carry any property, and guessing at one
 * would reject content that works.
 */
export const propertyProblem = (
	nodeType: string,
	property: string,
	value: unknown,
): { needs: string } | undefined => {
	const constraints: Readonly<Record<string, Constraint>> =
		nodeType === "root"
			? ROOT_PROPERTIES
			: {
					...UNIVERSAL_PROPERTIES,
					...(REQUIRED_NODE_PROPERTIES[nodeType] ?? {}),
				};

	const constraint = constraints[property];

	return constraint === undefined || accepts(constraint, value)
		? undefined
		: { needs: needs(constraint) };
};

/**
 * Values a feature restricts a node property to, keyed by node type and then by
 * the property on the node that carries the value.
 */
export type NodeOptions = Record<string, Record<string, string[]>>;

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
export const nodeOptions = (
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
