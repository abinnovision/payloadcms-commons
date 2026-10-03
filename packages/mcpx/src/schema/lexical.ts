import { flattenAllFields } from "payload";

import { isPlainObject, ownValue } from "../guards.js";

import type {
	Field,
	FlattenedBlocksField,
	FlattenedField,
	RichTextField,
} from "payload";

/*
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

/*
 * Sub-fields exist but cannot be addressed by a schema path. Without a node,
 * `upload` returns every enabled collection's upload fields concatenated, which
 * describes no single position.
 */
const OPAQUE_NODE_TYPES: ReadonlySet<string> = new Set(["upload"]);

/*
 * Typed structurally so the plugin does not depend on
 * `@payloadcms/richtext-lexical`. `getSubFields` is the hook Payload runs a
 * node's fields through. Called without a node it returns every sub-field the
 * node can hold, which is a schema, and any feature that declares one fills
 * it, so custom features need no special case.
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

/*
 * `blocks` covers nodes that pick a definition by slug, as the Lexical block
 * features do, so the walkers treat it like a Payload blocks field. `fields`
 * covers everything else, such as a link node.
 */
type LexicalSubSchema =
	| { blocksField: FlattenedBlocksField; kind: "blocks" }
	| { fields: FlattenedField[]; kind: "fields" };

/*
 * `null` records a node type that was asked and has nothing to describe, so it
 * is asked only once. Cached because describe and validate resolve the same
 * field repeatedly and the block features rebuild their answer on every call.
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

/*
 * What a serialized property has to be. A name is a kind; `{ is }` pins an
 * exact value, which a node class occasionally demands.
 */
type Constraint = Kind | { is: number | string };

type Kind = keyof typeof KINDS;

/*
 * `direction` follows Payload's own declaration (`"ltr"`, `"rtl"` or null)
 * instead of a looser "string or null".
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
		accepts: isPlainObject,
		needs: "an object",
	},
	optionalObject: {
		accepts: (value: unknown) => value === null || isPlainObject(value),
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

// A text node and everything built on one.
const TEXT_PROPERTIES = {
	detail: "number",
	format: "number",
	mode: "string",
	style: "string",
	text: "string",
} as const satisfies Record<string, Constraint>;

/*
 * Carried by every node. Aligned with Payload, not measured: its `outputSchema`
 * requires `type` and `version` on every node, which types the field in
 * `payload-types.ts`. Lexical hydrates a node with a missing or mistyped
 * `version` unchanged, but the generated types promise an integer and
 * `BlockNode.importJSON` migrates on it.
 */
const UNIVERSAL_PROPERTIES = { version: "number" } as const satisfies Record<
	string,
	Constraint
>;

/**
 * The root as Payload declares it and an editor exports it: these six
 * properties, these kinds, nothing else.
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
 * by node type. Payload stores a state without hydrating it, so a node missing
 * these fails only later, in the admin editor. Payload declares nothing per
 * node type, so the table is measured: an entry belongs only if breaking it
 * makes Lexical throw or changes what the editor reads back. A type with no
 * entry is not guessed at, since that would reject a project's working nodes.
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
	 * A tab is a text node holding one tab character. Both values are exact
	 * because `setDetail` and `setTextContent` throw for any other value.
	 */
	tab: { ...TEXT_PROPERTIES, detail: { is: 2 }, text: { is: "\t" } },
	text: TEXT_PROPERTIES,
	/*
	 * An upload node's sub-fields depend on the collection it points at and
	 * cannot be addressed through a schema path, so "fields" is usually null. It
	 * is still required: Lexical reads the node back without it.
	 */
	upload: { fields: "optionalObject", relationTo: "string", value: "number" },
};

/**
 * Whether the table already says what a node type's `fields` must be, so the
 * sub-field walk does not report the same problem twice.
 */
export const constrainsFields = (type: string): boolean =>
	"fields" in (ownValue(REQUIRED_NODE_PROPERTIES, type) ?? {});

const describeConstraints = (
	constraints: Readonly<Record<string, Constraint>>,
): Record<string, string> =>
	Object.fromEntries(
		Object.entries(constraints)
			.map(([property, constraint]) => [property, needs(constraint)] as const)
			.sort((left, right) => left[0].localeCompare(right[0])),
	);

/**
 * What each node type must carry, phrased as the write side phrases its
 * refusals so the two never disagree. Keyed by node type, since a `text` node
 * needs the same wherever it is written. `type` is listed although
 * {@link UNIVERSAL_PROPERTIES} omits it: the validator finds the entry by
 * `type` and so never reports it missing, but a client must still write one.
 */
export const nodePropertiesFor = (
	types: readonly string[],
): Record<string, Record<string, string>> =>
	Object.fromEntries(
		[...new Set(types)].sort().map((type) => [
			type,
			describeConstraints(
				// The root is closed, not extended: these six and nothing else.
				type === "root"
					? ROOT_PROPERTIES
					: {
							...ownValue(REQUIRED_NODE_PROPERTIES, type),
							...UNIVERSAL_PROPERTIES,
							type: "string",
						},
			),
		]),
	);

/*
 * A property that is absent, and one that is present but cannot be what the
 * node class does with it.
 */
interface PropertyProblems {
	missing: string[];
	rejected: { needs: string; property: string }[];
}

// Present but `null` counts as present: `direction` is serialized that way.
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
		...ownValue(REQUIRED_NODE_PROPERTIES, node["type"] as string),
	});

/**
 * The root is the one node Payload describes itself, down to refusing an
 * unknown property, so it is checked against that description instead of the
 * walk's table.
 */
export const rootProblems = (
	root: Record<string, unknown>,
): PropertyProblems & { unexpected: string[] } => ({
	...check(root, ROOT_PROPERTIES),
	unexpected: Object.keys(root).filter(
		(property) => !Object.hasOwn(ROOT_PROPERTIES, property),
	),
});

/**
 * What one serialized property must be, for a write addressing a property
 * instead of a whole node. Absent where the table says nothing, matching the
 * node walk: a project's own node may carry any property.
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
					...ownValue(REQUIRED_NODE_PROPERTIES, nodeType),
				};

	const constraint = ownValue(constraints, property);

	return constraint === undefined || accepts(constraint, value)
		? undefined
		: { needs: needs(constraint) };
};

/**
 * Values a feature restricts a node property to, keyed by node type and then by
 * the property on the node that carries the value.
 */
export type NodeOptions = Record<string, Record<string, string[]>>;

/*
 * One node property a feature narrows, and where its setting is configured.
 * `defaults` is what the feature falls back to: a feature added without
 * arguments records nothing, because the default lives in its own destructuring
 * and never reaches its props.
 */
interface NodeOptionSource {
	defaults: readonly string[];
	featureKey: string;
	featureProp: string;
	nodeProp: string;
	nodeType: string;
}

/*
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

/*
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
