import { fieldIsHiddenOrDisabled, fieldIsVirtual } from "payload/shared";

import { allowedNodeTypes } from "./lexical.js";

import type {
	Field,
	FlattenedBlock,
	FlattenedBlocksField,
	FlattenedField,
	SanitizedCollectionConfig,
	SanitizedConfig,
	TabAsField,
} from "payload";

/**
 * One writable field, addressed relative to the node that declares it.
 *
 * `path` is dotted and already resolved through every construct that does not
 * nest in the stored document, so it becomes a JSON Pointer by replacing `.`
 * with `/` and each `[]` with an index.
 */
interface FieldDescriptor {
	blocks?: string[];
	description?: Record<string, string> | string;
	hasMany?: true;
	localized?: true;
	maxRows?: number;
	minRows?: number;
	nodes?: string[];
	options?: string[];
	path: string;
	readOnly?: true;
	relationTo?: string | string[];
	required?: true;
	type: string;
}

/**
 * Fields Payload maintains, which a client may neither address nor supply.
 */
const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
	"_status",
	"createdAt",
	"deletedAt",
	"id",
	"updatedAt",
]);

/**
 * Marks the element position of an array inside a descriptor path.
 */
const ARRAY_MARKER = "[]";

/**
 * Joins path segments, attaching the array marker to its field rather than
 * separating it, so an array subfield reads `items[].title`.
 */
const joinPath = (parts: readonly string[]): string =>
	parts.reduce(
		(path, part) =>
			part === ARRAY_MARKER
				? `${path}${ARRAY_MARKER}`
				: path
					? `${path}.${part}`
					: part,
		"",
	);

/**
 * Splits a descriptor path back into pointer-comparable segments, with the
 * array marker as a segment of its own.
 */
const splitPath = (path: string): string[] =>
	path
		.split(".")
		.flatMap((part) =>
			part.endsWith(ARRAY_MARKER)
				? [part.slice(0, -ARRAY_MARKER.length), ARRAY_MARKER]
				: [part],
		);

/**
 * Blocks a blocks field accepts, by slug. On a flattened field, whichever of
 * `blockReferences` and `blocks` was declared carries the definitions.
 */
const blockSlugsOf = (field: FlattenedBlocksField): string[] => [
	...new Set(
		(field.blockReferences ?? field.blocks).map((block) =>
			typeof block === "string" ? block : block.slug,
		),
	),
];

/**
 * Resolves one of a blocks field's slugs to its definition.
 *
 * A definition inlined on the field wins over the shared registry. A block's
 * own fields are identical wherever it appears, but the blocks its children
 * accept are not, so an inline definition has to be read at its position.
 * The registry (`config.blocks`) is the fallback for slugs referenced by name.
 */
const blockOf = (
	config: SanitizedConfig,
	field: FlattenedBlocksField,
	slug: string,
): FlattenedBlock | undefined => {
	const declared = field.blockReferences ?? field.blocks;

	const inline = declared.find(
		(block): block is FlattenedBlock =>
			typeof block !== "string" && block.slug === slug,
	);

	if (inline) {
		return inline;
	}

	return declared.includes(slug)
		? config.blocks?.find((block) => block.slug === slug)
		: undefined;
};

const isSkipped = (field: FlattenedField): boolean =>
	!("name" in field) ||
	field.type === "join" ||
	RESERVED_FIELD_NAMES.has(field.name) ||
	fieldIsVirtual(field) ||
	fieldIsHiddenOrDisabled(field as Field | TabAsField);

const isReadOnly = (field: FlattenedField): boolean =>
	"admin" in field && field.admin.readOnly === true;

/**
 * The `admin.description` of a field or collection, when it is serializable:
 * a string or a locale-keyed record. Functions and components are admin-UI
 * constructs and are dropped.
 */
const staticDescription = (
	description: unknown,
): Record<string, string> | string | undefined => {
	if (typeof description === "string") {
		return description;
	}

	return typeof description === "object" &&
		description !== null &&
		Object.values(description).every((entry) => typeof entry === "string")
		? (description as Record<string, string>)
		: undefined;
};

const describeBase = (
	field: FlattenedField,
	path: string,
	readOnly: boolean,
): FieldDescriptor => {
	const description = staticDescription(
		"admin" in field ? field.admin.description : undefined,
	);

	return {
		path,
		type: field.type,
		...(description === undefined ? {} : { description }),
		...("required" in field && field.required
			? { required: true as const }
			: {}),
		...("localized" in field && field.localized
			? { localized: true as const }
			: {}),
		...(readOnly ? { readOnly: true as const } : {}),
	};
};

const describeLeaf = (
	field: FlattenedField,
	path: string,
	readOnly: boolean,
): FieldDescriptor => {
	const descriptor = describeBase(field, path, readOnly);

	if (field.type === "select" || field.type === "radio") {
		descriptor.options = field.options.map((option) =>
			typeof option === "string" ? option : option.value,
		);
	}

	if (field.type === "relationship" || field.type === "upload") {
		descriptor.relationTo = field.relationTo;
	}

	if (
		(field.type === "select" ||
			field.type === "relationship" ||
			field.type === "upload") &&
		field.hasMany === true
	) {
		descriptor.hasMany = true;
	}

	if (field.type === "richText") {
		descriptor.nodes = allowedNodeTypes(field);
	}

	return descriptor;
};

const withRows = (
	descriptor: FieldDescriptor,
	field: { maxRows?: number; minRows?: number },
): FieldDescriptor => ({
	...descriptor,
	...(field.minRows === undefined ? {} : { minRows: field.minRows }),
	...(field.maxRows === undefined ? {} : { maxRows: field.maxRows }),
});

/**
 * Flattens a field list into descriptors addressed relative to the node.
 *
 * The input is Payload's own flattened shape, which has already merged every
 * construct that exists only in the admin UI (unnamed tabs, unnamed groups,
 * `row`, `collapsible`) and dropped `ui` fields. Named tabs, groups and
 * arrays contribute a path segment. The walk stops at every blocks field and
 * names the slugs instead of descending, which keeps a node proportional to
 * the number of blocks it allows rather than to the size of their definitions.
 */
const describeFields = (
	fields: FlattenedField[],
	prefix: readonly string[] = [],
	parentReadOnly = false,
): FieldDescriptor[] =>
	fields.flatMap((field): FieldDescriptor[] => {
		if (isSkipped(field)) {
			return [];
		}

		const readOnly = parentReadOnly || isReadOnly(field);
		const path = [...prefix, field.name];

		if (field.type === "tab" || field.type === "group") {
			return describeFields(field.flattenedFields, path, readOnly);
		}

		if (field.type === "array") {
			return describeFields(
				field.flattenedFields,
				[...path, ARRAY_MARKER],
				readOnly,
			);
		}

		if (field.type === "blocks") {
			return [
				withRows(
					{
						...describeBase(field, joinPath(path), readOnly),
						blocks: blockSlugsOf(field),
					},
					field,
				),
			];
		}

		return [describeLeaf(field, joinPath(path), readOnly)];
	});

/**
 * Locates the blocks field that a resolved descriptor path refers to.
 */
const findBlocksField = (
	fields: FlattenedField[],
	path: readonly string[],
): FlattenedBlocksField | undefined => {
	for (const field of fields) {
		if (!("name" in field) || field.name !== path[0]) {
			continue;
		}

		if (field.type === "blocks" && path.length === 1) {
			return field;
		}

		if (field.type === "tab" || field.type === "group") {
			return findBlocksField(field.flattenedFields, path.slice(1));
		}

		if (field.type === "array" && path[1] === ARRAY_MARKER) {
			return findBlocksField(field.flattenedFields, path.slice(2));
		}
	}

	return undefined;
};

/**
 * Names a collection or a global before its config is looked up. Everything in
 * the schema layer is written against this rather than a bare slug, because a
 * slug alone cannot say which of the two namespaces it belongs to.
 */
interface TargetRef {
	kind: "collection" | "global";
	slug: string;
}

/**
 * The part of a sanitized config the schema walkers actually consume. Both
 * `SanitizedCollectionConfig` and `SanitizedGlobalConfig` satisfy it, so
 * `targetOf` returns without a cast and no caller has to narrow.
 */
interface SchemaTarget {
	fields: Field[];
	flattenedFields: FlattenedField[];
	slug: string;
}

const targetOf = (config: SanitizedConfig, ref: TargetRef): SchemaTarget => {
	const found =
		ref.kind === "collection"
			? config.collections.find((candidate) => candidate.slug === ref.slug)
			: config.globals.find((candidate) => candidate.slug === ref.slug);

	if (!found) {
		throw new Error(`Unknown ${ref.kind} "${ref.slug}".`);
	}

	return found;
};

const collectionOf = (
	config: SanitizedConfig,
	collection: string,
): SanitizedCollectionConfig => {
	const found = config.collections.find(
		(candidate) => candidate.slug === collection,
	);

	if (!found) {
		throw new Error(`Unknown collection "${collection}".`);
	}

	return found;
};

export {
	ARRAY_MARKER,
	RESERVED_FIELD_NAMES,
	blockOf,
	blockSlugsOf,
	collectionOf,
	describeFields,
	findBlocksField,
	joinPath,
	splitPath,
	staticDescription,
	targetOf,
};
export type { FieldDescriptor, SchemaTarget, TargetRef };
