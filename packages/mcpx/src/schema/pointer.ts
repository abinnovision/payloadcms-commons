import { resolveLexicalPointer } from "./lexical-pointer.js";
import {
	ARRAY_MARKER,
	blockOf,
	blockSlugsOf,
	describeAddressableFields,
	findBlocksField,
	findRichTextField,
	isIndexSegment,
	joinPath,
	splitPath,
	targetOf,
} from "./walk.js";

import type { LexicalPosition } from "./lexical-pointer.js";
import type { FieldDescriptor, TargetRef } from "./walk.js";
import type { FlattenedField, SanitizedConfig } from "payload";

/**
 * `descriptor` is set when the pointer addresses one field exactly. Otherwise
 * the pointer addresses a subtree (a whole group, an array element or a block
 * element) and `fields`/`prefix` describe what may appear beneath it. `prefix`
 * is held as segments, since it is a position inside `fields` rather than an
 * address a client could use.
 *
 * `lexical` accompanies `descriptor` when the pointer runs on into a rich text
 * field's editor state. The descriptor stays the field's own, so read-only and
 * the editor's node list apply to every position inside it.
 *
 * `readOnly` records a flag picked up on the way down. A block's fields and a
 * Lexical node's fields are each walked as a fresh schema, which is where a
 * read-only ancestor would otherwise be forgotten.
 *
 * `inLexical` marks a position reached through an editor state even though it
 * ended up on an ordinary field, which a node's own fields are. What may be
 * done to a field differs there, so the distinction has to survive the walk.
 */
export interface PointerResolution {
	blockType?: string;
	descriptor?: FieldDescriptor;
	fields: FlattenedField[];
	inLexical?: true;
	lexical?: LexicalPosition;
	prefix: readonly string[];
	readOnly?: true;
}

/**
 * `addedValue` supplies the block discriminant for an `add` at a position the
 * document does not have yet.
 */
interface PointerTarget {
	addedValue?: unknown;
	doc: unknown;
	pointer: string;
	ref: TargetRef;
}

const partMatches = (part: string, segment: string | undefined): boolean =>
	segment !== undefined &&
	(part === ARRAY_MARKER ? isIndexSegment(segment) : part === segment);

/**
 * Longest descriptor whose path is fully consumed by the leading segments.
 */
const longestMatch = (
	descriptors: FieldDescriptor[],
	segments: readonly string[],
): { consumed: number; descriptor: FieldDescriptor } | undefined =>
	descriptors
		.map((descriptor) => ({
			consumed: splitPath(descriptor.path).length,
			descriptor,
			parts: splitPath(descriptor.path),
		}))
		.filter(({ parts }) =>
			parts.every((part, offset) => partMatches(part, segments[offset])),
		)
		.sort((left, right) => right.consumed - left.consumed)[0];

/** Stopping part-way through a descriptor's path means a subtree, not a field. */
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

/**
 * Unlike a descriptor path, the segments carry real indices, so intervening
 * array fields are descended through rather than skipped.
 */
const valueAtSegments = (data: unknown, segments: readonly string[]): unknown =>
	segments.reduce<unknown>(
		(current, segment) =>
			current === null || typeof current !== "object"
				? undefined
				: (current as Record<string, unknown>)[segment],
		data,
	);

/**
 * The stored row decides which block sits at an index, since a blocks field
 * admits many shapes at the same position. A row the document does not have
 * yet takes its slug from the value being added.
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
		throw new Error(
			`"${descriptor.path}" is an array; "${index}" is not an index.`,
		);
	}

	const field = findBlocksField(at.fields, splitPath(descriptor.path));

	const existing =
		Array.isArray(rows) && index !== "-"
			? (rows[Number(index)] as { blockType?: string } | undefined)
			: undefined;

	const slug =
		existing?.blockType ??
		(addedValue as { blockType?: string } | undefined)?.blockType;

	if (!field || slug === undefined) {
		throw new Error(
			`Cannot tell which block "${descriptor.path}/${index}" is. Supply a "blockType" on the value, one of: ${field ? blockSlugsOf(field).join(", ") : ""}`,
		);
	}

	const block = blockOf(config, field, slug);

	if (!block) {
		throw new Error(
			`"${slug}" is not allowed at "${descriptor.path}". Allowed: ${blockSlugsOf(field).join(", ")}`,
		);
	}

	return {
		blockType: slug,
		data: existing,
		fields: block.flattenedFields,
		rest: remaining,
	};
};

/**
 * The stored document chooses the branch at every blocks element, and is
 * required rather than optional: `/layout/sections/3/modules/1`
 * can only be resolved by reading `blockType` off `sections[3]`, since a blocks
 * field admits many shapes at the same index.
 */
export const resolveDataPointer = (
	config: SanitizedConfig,
	target: PointerTarget,
): PointerResolution => {
	let fields = targetOf(config, target.ref).flattenedFields;
	let data: unknown = target.doc;
	let blockType: string | undefined;
	let segments = splitPath(target.pointer);
	let readOnly: true | undefined;
	let inLexical: true | undefined;

	while (segments.length > 0) {
		const descriptors = describeAddressableFields(fields);
		const match = longestMatch(descriptors, segments);

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

			throw new Error(
				`"${joinPath(segments)}" is not a field here. Available: ${descriptors
					.map((descriptor) => descriptor.path)
					.join(", ")}`,
			);
		}

		const rest = segments.slice(match.consumed);

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
			const field = findRichTextField(fields, splitPath(match.descriptor.path));

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
				state: valueAtSegments(data, segments.slice(0, match.consumed)),
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
			 * A node's `fields` is ordinary Payload field-land, so the walk
			 * resumes rather than growing a second traversal beside it.
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
			throw new Error(
				`"${match.descriptor.path}" is a ${match.descriptor.type} field and has no "${joinPath(rest)}" beneath it.`,
			);
		}

		const step = stepIntoBlock({
			addedValue: target.addedValue,
			descriptor: match.descriptor,
			fields,
			rest,
			rows: valueAtSegments(data, segments.slice(0, match.consumed)),
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
