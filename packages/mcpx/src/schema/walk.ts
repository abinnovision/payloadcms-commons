import { fieldIsHiddenOrDisabled, fieldIsVirtual } from "payload/shared";

import { allowedNodeTypes, nodeOptions } from "./lexical.js";
import { translateAny } from "../i18n.js";

import type { NodeOptions } from "./lexical.js";
import type { Translate } from "../i18n.js";
import type {
	Field,
	FlattenedBlock,
	FlattenedBlocksField,
	FlattenedField,
	RichTextField,
	SanitizedCollectionConfig,
	SanitizedConfig,
	TabAsField,
} from "payload";

/**
 * One writable field, addressed relative to the node that declares it.
 *
 * `path` uses JSON Pointer syntax and is already resolved through every
 * construct that does not nest in the stored document, so it becomes a pointer
 * into a document by replacing each {@link ARRAY_MARKER} with an index.
 */
interface FieldDescriptor {
	blocks?: string[];
	description?: string;
	hasMany?: true;
	localized?: true;
	max?: number;
	maxLength?: number;
	maxRows?: number;
	min?: number;
	minLength?: number;
	minRows?: number;
	nodeOptions?: NodeOptions;
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
 * Marks the element position of an array inside a descriptor path, where a
 * pointer into a document carries an index. Not a legal Payload field name,
 * and deliberately not `-`, which RFC 6901 already reads as "append here".
 */
const ARRAY_MARKER = "*";

/**
 * Shape a JSON Pointer must have to be parseable at all.
 */
const JSON_POINTER_PATTERN = /^(\/([^~/]|~[01])*)*$/;

/**
 * Joins segments into a JSON Pointer, so the segments `items`, `*`, `title`
 * read as one path to a subfield of every element of `items`. No segments is
 * the root pointer, `""`.
 */
const joinPath = (parts: readonly string[]): string =>
	parts
		.map((part) => `/${part.replace(/~/g, "~0").replace(/\//g, "~1")}`)
		.join("");

/**
 * Splits a JSON Pointer into its segments, unescaping `~1` and `~0`. The root
 * pointer yields no segments.
 */
const splitPath = (path: string): string[] =>
	path
		.split("/")
		.slice(1)
		.map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

/**
 * Restates a path Payload reports on a validation error (`layout.0.title`) as
 * a JSON Pointer, so everything this plugin hands back addresses documents the
 * same way. Payload's path already carries real indices, so it maps directly.
 */
const pointerFromPayloadPath = (path: string): string =>
	path ? joinPath(path.split(".")) : "";

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
 * Where one field sits in the walk: its resolved path, whether anything above
 * it is read-only, and the translator resolving its description.
 */
interface DescribeAt {
	path: string;
	readOnly: boolean;
	translate: Translate;
}

const describeBase = (
	field: FlattenedField,
	{ path, readOnly, translate }: DescribeAt,
): FieldDescriptor => {
	const description = translate(
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
	at: DescribeAt,
): FieldDescriptor => {
	const descriptor = describeBase(field, at);

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

	if (
		(field.type === "text" || field.type === "textarea") &&
		field.maxLength !== undefined
	) {
		descriptor.maxLength = field.maxLength;
	}

	if (
		(field.type === "text" || field.type === "textarea") &&
		field.minLength !== undefined
	) {
		descriptor.minLength = field.minLength;
	}

	if (field.type === "number" && field.max !== undefined) {
		descriptor.max = field.max;
	}

	if (field.type === "number" && field.min !== undefined) {
		descriptor.min = field.min;
	}

	if (field.type === "richText") {
		descriptor.nodes = allowedNodeTypes(field);

		const options = nodeOptions(field, descriptor.nodes);

		if (options) {
			descriptor.nodeOptions = options;
		}
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
 * Whether a descriptor stands for a construct that only holds other fields.
 *
 * These describe a position rather than a value, so everything that resolves a
 * path to something writable skips them; only {@link describeNode} reports
 * them, to carry what the container itself declares.
 */
const isContainer = (descriptor: FieldDescriptor): boolean =>
	descriptor.type === "array" ||
	descriptor.type === "group" ||
	descriptor.type === "tab";

/**
 * Whether a container declares anything a client could not infer from the
 * fields beneath it. A group that exists only to nest is not worth reporting.
 */
const isInformative = (descriptor: FieldDescriptor): boolean =>
	descriptor.description !== undefined ||
	descriptor.required === true ||
	descriptor.localized === true;

/**
 * Flattens a field list into descriptors addressed relative to the node.
 *
 * The input is Payload's own flattened shape, which has already merged every
 * construct that exists only in the admin UI (unnamed tabs, unnamed groups,
 * `row`, `collapsible`) and dropped `ui` fields. Named tabs, groups and
 * arrays contribute a path segment, and are described in their own right when
 * they declare something of their own: an array always, since its row counts
 * live nowhere else, a group or tab only when it carries a description or a
 * constraint. The walk stops at every blocks field and names the slugs instead
 * of descending, which keeps a node proportional to the number of blocks it
 * allows rather than to the size of their definitions.
 *
 * `translate` resolves each `admin.description` to the request's language.
 * Callers that walk for paths alone leave it out and get the language-agnostic
 * default, so a missing argument costs language selection, never the
 * description itself.
 */
const describeFields = (
	fields: FlattenedField[],
	translate: Translate = translateAny,
): FieldDescriptor[] => {
	const walk = (
		current: FlattenedField[],
		prefix: readonly string[],
		parentReadOnly: boolean,
	): FieldDescriptor[] =>
		current.flatMap((field): FieldDescriptor[] => {
			if (isSkipped(field)) {
				return [];
			}

			const readOnly = parentReadOnly || isReadOnly(field);
			const path = [...prefix, field.name];
			const at = { path: joinPath(path), readOnly, translate };

			if (field.type === "tab" || field.type === "group") {
				const own = describeBase(field, at);

				return [
					...(isInformative(own) ? [own] : []),
					...walk(field.flattenedFields, path, readOnly),
				];
			}

			if (field.type === "array") {
				return [
					withRows(describeBase(field, at), field),
					...walk(field.flattenedFields, [...path, ARRAY_MARKER], readOnly),
				];
			}

			if (field.type === "blocks") {
				return [
					withRows(
						{ ...describeBase(field, at), blocks: blockSlugsOf(field) },
						field,
					),
				];
			}

			return [describeLeaf(field, at)];
		});

	return walk(fields, [], false);
};

/**
 * The descriptors that address a value, which is what every walk resolving a
 * path against a document needs. A container describes a position rather than
 * a value, so only {@link describeNode} reports one.
 */
const describeAddressableFields = (
	fields: FlattenedField[],
): FieldDescriptor[] =>
	describeFields(fields).filter((descriptor) => !isContainer(descriptor));

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
 * Locates the rich text field that a resolved descriptor path refers to, so
 * its editor can be introspected for the fields its nodes carry.
 */
const findRichTextField = (
	fields: FlattenedField[],
	path: readonly string[],
): RichTextField | undefined => {
	for (const field of fields) {
		if (!("name" in field) || field.name !== path[0]) {
			continue;
		}

		if (field.type === "richText" && path.length === 1) {
			return field;
		}

		if (field.type === "tab" || field.type === "group") {
			return findRichTextField(field.flattenedFields, path.slice(1));
		}

		if (field.type === "array" && path[1] === ARRAY_MARKER) {
			return findRichTextField(field.flattenedFields, path.slice(2));
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
	JSON_POINTER_PATTERN,
	RESERVED_FIELD_NAMES,
	blockOf,
	blockSlugsOf,
	collectionOf,
	describeAddressableFields,
	describeFields,
	findBlocksField,
	findRichTextField,
	joinPath,
	pointerFromPayloadPath,
	splitPath,
	targetOf,
};
export type { FieldDescriptor, SchemaTarget, TargetRef };
