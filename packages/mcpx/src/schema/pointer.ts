import { SchemaError } from "./errors.js";
import { resolveLexicalPointer } from "./lexical-pointer.js";
import { isIndexSegment, joinPath, splitPath } from "./path.js";
import {
	ARRAY_MARKER,
	blockSlugsOf,
	describeAddressableFields,
	findFieldAt,
	longestMatch,
	requireBlock,
	schemaOf,
} from "./walk.js";
import { propOf } from "../guards.js";

import type { LexicalPosition } from "./lexical-pointer.js";
import type { FieldDescriptor } from "./walk.js";
import type { EntityRef } from "../entity.js";
import type { FlattenedField, SanitizedConfig } from "payload";

/**
 * Where a pointer lands: on one field exactly, or on a subtree (a group, an
 * array element or a block element) where `fields` and `prefix` describe what
 * may appear beneath it.
 */
export interface PointerResolution {
	blockType?: string;
	/**
	 * Set when the pointer addresses one field exactly.
	 */
	descriptor?: FieldDescriptor;
	fields: FlattenedField[];
	/**
	 * Reached through an editor state but ended on an ordinary field, such as a
	 * node's own fields. What may be done to it differs there.
	 */
	inLexical?: true;
	/**
	 * Set with `descriptor` when the pointer runs on into an editor state. The
	 * descriptor stays the field's own, so read-only and the node list apply to
	 * every position inside it.
	 */
	lexical?: LexicalPosition;
	/**
	 * Segments, since it is a position inside `fields`, not a client address.
	 */
	prefix: readonly string[];
	/**
	 * Picked up on the way down. Blocks and Lexical nodes are walked as fresh
	 * schemas, where a read-only ancestor would otherwise be forgotten.
	 */
	readOnly?: true;
}

/*
 * `addedValue` supplies the block discriminant for an `add` at a position the
 * document does not have yet.
 */
interface PointerInput {
	addedValue?: unknown;
	doc: unknown;
	pointer: string;
	ref: EntityRef;
}

const partMatches = (part: string, segment: string | undefined): boolean =>
	segment !== undefined &&
	(part === ARRAY_MARKER ? isIndexSegment(segment) : part === segment);

// Stopping part-way through a descriptor's path means a subtree, not a field.
const isSubtreePrefix = (
	descriptors: FieldDescriptor[],
	segments: readonly string[],
): boolean =>
	descriptors.some((descriptor) => {
		const parts = splitPath(descriptor.path);

		return (
			parts.length > segments.length &&
			segments.every((segment, offset) => {
				const part = parts[offset];

				return part !== undefined && partMatches(part, segment);
			})
		);
	});

/*
 * Unlike a descriptor path, the segments carry real indices, so intervening
 * array fields are descended through instead of skipped.
 */
const valueAtSegments = (data: unknown, segments: readonly string[]): unknown =>
	segments.reduce<unknown>(
		(current, segment) =>
			current === null || typeof current !== "object"
				? undefined
				: (current as Record<string, unknown>)[segment],
		data,
	);

/*
 * The stored row decides which block sits at an index, since a blocks field
 * admits many shapes at the same position. A row the document does not have yet
 * takes its slug from the value being added.
 */
const stepIntoBlock = (at: {
	addedValue?: unknown;
	config: SanitizedConfig;
	descriptor: FieldDescriptor;
	fields: FlattenedField[];
	rest: readonly string[];
	rows: unknown;
}): {
	blockType: string;
	data: unknown;
	fields: FlattenedField[];
	rest: string[];
} => {
	const { addedValue, config, descriptor, rows } = at;
	const [index, ...remaining] = at.rest as [string, ...string[]];

	if (!isIndexSegment(index)) {
		throw new SchemaError(
			`"${descriptor.path}" is an array; "${index}" is not an index.`,
		);
	}

	const field = findFieldAt(at.fields, splitPath(descriptor.path), "blocks");

	const existing: unknown =
		Array.isArray(rows) && index !== "-" ? rows[Number(index)] : undefined;

	const slug = propOf(existing, "blockType") ?? propOf(addedValue, "blockType");

	if (!field || slug === undefined) {
		throw new SchemaError(
			`Cannot tell which block "${descriptor.path}/${index}" is. Supply a "blockType" on the value, one of: ${field ? blockSlugsOf(field).join(", ") : ""}`,
		);
	}

	if (typeof slug !== "string") {
		throw new SchemaError(
			`"blockType" must be a string naming a block at "${descriptor.path}". Allowed: ${blockSlugsOf(field).join(", ")}`,
		);
	}

	const block = requireBlock(config, field, slug, descriptor.path);

	return {
		blockType: slug,
		data: existing,
		fields: block.flattenedFields,
		rest: remaining,
	};
};

/**
 * The stored document is required because it chooses the branch at every blocks
 * element: `/layout/sections/3/modules/1` can only be resolved by reading
 * `blockType` off `sections[3]`.
 */
export const resolveDataPointer = (
	config: SanitizedConfig,
	target: PointerInput,
): PointerResolution => {
	let fields = schemaOf(config, target.ref).flattenedFields;
	let data: unknown = target.doc;
	let blockType: string | undefined;
	let segments = splitPath(target.pointer);
	let readOnly: true | undefined;
	let inLexical: true | undefined;

	while (segments.length > 0) {
		const descriptors = describeAddressableFields(fields);
		const match = longestMatch(descriptors, segments, partMatches);

		if (!match) {
			if (isSubtreePrefix(descriptors, segments)) {
				return {
					...(blockType === undefined ? {} : { blockType }),
					fields,
					/*
					 * Descriptor paths carry `*` where a document carries an index,
					 * so the prefix is stated the way its consumers match it.
					 */
					prefix: segments.map((segment) =>
						isIndexSegment(segment) ? ARRAY_MARKER : segment,
					),
				};
			}

			throw new SchemaError(
				`"${joinPath(segments)}" is not a field here. Available: ${descriptors
					.map((descriptor) => descriptor.path)
					.join(", ")}`,
			);
		}

		const rest = segments.slice(match.parts.length);

		if (rest.length === 0) {
			return {
				...(blockType === undefined ? {} : { blockType }),
				descriptor: match.descriptor,
				fields,
				prefix: [],
				...(inLexical === undefined ? {} : { inLexical }),
				...(readOnly === undefined ? {} : { readOnly }),
			};
		}

		if (match.descriptor.type === "richText") {
			const field = findFieldAt(
				fields,
				splitPath(match.descriptor.path),
				"richText",
			);

			// The descriptor came from these fields, so a miss is a fault in the walk.
			if (!field) {
				throw new Error(`"${match.descriptor.path}" could not be resolved.`);
			}

			const step = resolveLexicalPointer({
				...(target.addedValue === undefined
					? {}
					: { addedValue: target.addedValue }),
				config,
				descriptor: match.descriptor,
				field,
				segments: rest,
				state: valueAtSegments(data, segments.slice(0, match.parts.length)),
			});

			if (step.kind === "position") {
				return {
					...(blockType === undefined ? {} : { blockType }),
					descriptor: match.descriptor,
					fields,
					lexical: step.position,
					prefix: [],
					...(readOnly === undefined ? {} : { readOnly }),
				};
			}

			/*
			 * A node's `fields` are ordinary Payload fields, so the walk resumes
			 * instead of adding a second traversal.
			 */
			inLexical = true;
			readOnly = match.descriptor.readOnly ?? readOnly;
			blockType = step.blockType;
			fields = step.fields;
			data = step.data;
			segments = step.rest;

			continue;
		}

		if (match.descriptor.type !== "blocks") {
			throw new SchemaError(
				`"${match.descriptor.path}" is a ${match.descriptor.type} field and has no "${joinPath(rest)}" beneath it.`,
			);
		}

		const step = stepIntoBlock({
			addedValue: target.addedValue,
			descriptor: match.descriptor,
			fields,
			rest,
			rows: valueAtSegments(data, segments.slice(0, match.parts.length)),
			config,
		});

		readOnly = match.descriptor.readOnly ?? readOnly;
		blockType = step.blockType;
		fields = step.fields;
		data = step.data;
		segments = step.rest;
	}

	return {
		...(blockType === undefined ? {} : { blockType }),
		fields,
		...(inLexical === undefined ? {} : { inLexical }),
		prefix: [],
		...(readOnly === undefined ? {} : { readOnly }),
	};
};
