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
	SanitizedConfig,
	TabAsField,
} from "payload";

/**
 * One writable field, addressed relative to the node that declares it.
 *
 * `path` uses JSON Pointer syntax and is already resolved through every
 * construct that does not nest in the stored document, so it becomes a pointer
 * into a document by replacing each {@link ARRAY_MARKER} with an index.
 *
 * Inside a rich text field that substitution does not apply. A path there names
 * the node type, and a block node its slug, where a pointer enters the stored
 * state at `root` and walks `children` by an index counted over every child at
 * that level, not over the blocks among them, carrying the node's own fields
 * under `fields`: `/content/block/practice-note/variant` is written at
 * `/content/root/children/7/fields/variant`.
 */
export interface FieldDescriptor {
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

export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
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
export const ARRAY_MARKER = "*";

export const JSON_POINTER_PATTERN = /^(\/([^~/]|~[01])*)*$/;

/** No segments is the root pointer, `""`. */
export const joinPath = (parts: readonly string[]): string =>
	parts
		.map((part) => `/${part.replace(/~/g, "~0").replace(/\//g, "~1")}`)
		.join("");

/** Unescapes `~1` and `~0`. The root pointer yields no segments. */
export const splitPath = (path: string): string[] =>
	path
		.split("/")
		.slice(1)
		.map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

/** `-` included, since RFC 6901 reads it as the position after the last. */
export const isIndexSegment = (segment: string): boolean =>
	segment === "-" || /^\d+$/.test(segment);

export const isPlainObject = (
	value: unknown,
): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A path Payload reports on a validation error (`layout.0.title`) as a JSON
 * Pointer, so everything handed back addresses documents the same way. The
 * path already carries real indices, so it maps directly.
 */
export const pointerFromPayloadPath = (path: string): string =>
	path ? joinPath(path.split(".")) : "";

/** On a flattened field, whichever of `blockReferences` and `blocks` was declared. */
export const blockSlugsOf = (field: FlattenedBlocksField): string[] => [
	...new Set(
		(field.blockReferences ?? field.blocks).map((block) =>
			typeof block === "string" ? block : block.slug,
		),
	),
];

/**
 * An inlined definition wins over the registry (`config.blocks`). A block's own
 * fields are identical wherever it appears, but the blocks its children accept
 * are not, so an inline definition has to be read at its position.
 */
export const blockOf = (
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

/**
 * Payload's `fieldIsHiddenOrDisabled` reads `hidden` and `admin.disabled`, not
 * `admin.hidden`, which is what its own upload base fields carry.
 */
const isAdminHidden = (field: FlattenedField): boolean =>
	"admin" in field && field.admin.hidden === true;

/** A field kept out of the admin panel is kept out of the MCP surface too. */
const isSkipped = (field: FlattenedField): boolean =>
	!("name" in field) ||
	field.type === "join" ||
	RESERVED_FIELD_NAMES.has(field.name) ||
	fieldIsVirtual(field) ||
	isAdminHidden(field) ||
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
 * A container describes a position rather than a value, so everything resolving
 * a path to something writable skips it. Only {@link nodeDescriber} reports one,
 * to carry what the container itself declares.
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
 * The input is Payload's own flattened shape, so the admin-only constructs
 * (unnamed tabs and groups, `row`, `collapsible`, `ui`) are already gone. Named
 * tabs, groups and arrays contribute a path segment, and are described in their
 * own right when they declare something of their own: an array always, since
 * its row counts live nowhere else, a group or tab only when it carries a
 * description or a constraint. The walk stops at every blocks field and names
 * the slugs, which keeps a node proportional to the number of blocks it allows
 * rather than to the size of their definitions.
 *
 * Omitting `translate` costs language selection, never the description itself.
 */
export const describeFields = (
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
 * a value, so only {@link nodeDescriber} reports one.
 */
export const describeAddressableFields = (
	fields: FlattenedField[],
): FieldDescriptor[] =>
	describeFields(fields).filter((descriptor) => !isContainer(descriptor));

interface FieldOfType {
	blocks: FlattenedBlocksField;
	richText: RichTextField;
}

const findFieldAt = <T extends keyof FieldOfType>(
	fields: FlattenedField[],
	path: readonly string[],
	type: T,
): FieldOfType[T] | undefined => {
	for (const field of fields) {
		if (!("name" in field) || field.name !== path[0]) {
			continue;
		}

		if (field.type === type && path.length === 1) {
			return field as FieldOfType[T];
		}

		if (field.type === "tab" || field.type === "group") {
			return findFieldAt(field.flattenedFields, path.slice(1), type);
		}

		if (field.type === "array" && path[1] === ARRAY_MARKER) {
			return findFieldAt(field.flattenedFields, path.slice(2), type);
		}
	}

	return undefined;
};

export const findBlocksField = (
	fields: FlattenedField[],
	path: readonly string[],
): FlattenedBlocksField | undefined => findFieldAt(fields, path, "blocks");

/**
 * Locates the rich text field that a resolved descriptor path refers to, so
 * its editor can be introspected for the fields its nodes carry.
 */
export const findRichTextField = (
	fields: FlattenedField[],
	path: readonly string[],
): RichTextField | undefined => findFieldAt(fields, path, "richText");

/**
 * Names a collection or a global before its config is looked up. Everything in
 * the schema layer is written against this rather than a bare slug, because a
 * slug alone cannot say which of the two namespaces it belongs to.
 */
export interface TargetRef {
	kind: "collection" | "global";
	slug: string;
}

/**
 * The part of a sanitized config the schema walkers actually consume. Both
 * `SanitizedCollectionConfig` and `SanitizedGlobalConfig` satisfy it, so
 * `targetOf` returns without a cast and no caller has to narrow.
 */
export interface SchemaTarget {
	fields: Field[];
	flattenedFields: FlattenedField[];
	slug: string;
}

/**
 * Looks up the sanitized config for a collection or global, as a
 * {@link SchemaTarget}. Throws on an unknown slug rather than returning
 * undefined, because a reference reaching here has already been checked against
 * the key's capabilities and a miss means the config changed underneath it.
 */
export const targetOf = (
	config: SanitizedConfig,
	ref: TargetRef,
): SchemaTarget => {
	const found =
		ref.kind === "collection"
			? config.collections.find((candidate) => candidate.slug === ref.slug)
			: config.globals.find((candidate) => candidate.slug === ref.slug);

	if (!found) {
		throw new Error(`Unknown ${ref.kind} "${ref.slug}".`);
	}

	return found;
};
