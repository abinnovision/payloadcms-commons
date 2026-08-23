import {
	ARRAY_MARKER,
	blockOf,
	blockSlugsOf,
	collectionOf,
	describeFields,
	findBlocksField,
	joinPath,
	splitPath,
} from "./walk.js";

import type { FieldDescriptor } from "./walk.js";
import type { FlattenedField, SanitizedConfig } from "payload";

/**
 * Where a JSON Pointer lands in the schema.
 *
 * `descriptor` is set when the pointer addresses one field exactly. Otherwise
 * the pointer addresses a subtree (a whole group, an array element or a block
 * element) and `fields`/`prefix` describe what may appear beneath it.
 */
interface PointerResolution {
	blockType?: string;
	descriptor?: FieldDescriptor;
	fields: FlattenedField[];
	prefix: string;
}

/**
 * What a pointer is being resolved against.
 *
 * `addedValue` supplies the block discriminant for an `add` at a position the
 * document does not have yet.
 */
interface PointerTarget {
	addedValue?: unknown;
	collection: string;
	doc: unknown;
	pointer: string;
}

const isIndexSegment = (segment: string): boolean =>
	segment === "-" || /^\d+$/.test(segment);

/**
 * Decodes a JSON Pointer into its segments, unescaping `~1` and `~0`.
 */
const pointerSegments = (pointer: string): string[] =>
	pointer
		.split("/")
		.slice(1)
		.map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

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

/**
 * Whether the segments stop part-way through some descriptor's path, which
 * means they address a subtree rather than a field.
 */
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
 * Reads the value the given pointer segments address. Unlike a descriptor
 * path, the segments carry real indices, so intervening array fields are
 * descended through rather than skipped.
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
 * Resolves a JSON Pointer against the schema, using the stored document to
 * choose a branch at every blocks element.
 *
 * The document is required rather than optional: `/layout/sections/3/modules/1`
 * can only be resolved by reading `blockType` off `sections[3]`, since a blocks
 * field admits many shapes at the same index.
 */
const resolveDataPointer = (
	config: SanitizedConfig,
	target: PointerTarget,
): PointerResolution => {
	let fields = collectionOf(config, target.collection).flattenedFields;
	let data: unknown = target.doc;
	let blockType: string | undefined;
	let segments = pointerSegments(target.pointer);

	while (segments.length > 0) {
		const descriptors = describeFields(fields);
		const match = longestMatch(descriptors, segments);

		if (!match) {
			if (isSubtreePrefix(descriptors, segments)) {
				return {
					...(blockType === undefined ? {} : { blockType }),
					fields,
					prefix: joinPath(segments),
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
				prefix: "",
			};
		}

		if (match.descriptor.type !== "blocks") {
			throw new Error(
				`"${match.descriptor.path}" is a ${match.descriptor.type} field and has no "${rest.join("/")}" beneath it.`,
			);
		}

		const [index, ...remaining] = rest as [string, ...string[]];

		if (!isIndexSegment(index)) {
			throw new Error(
				`"${match.descriptor.path}" is an array; "${index}" is not an index.`,
			);
		}

		const parts = splitPath(match.descriptor.path);
		const field = findBlocksField(fields, parts);
		const rows = valueAtSegments(data, segments.slice(0, match.consumed));

		const existing =
			Array.isArray(rows) && index !== "-"
				? (rows[Number(index)] as { blockType?: string } | undefined)
				: undefined;

		const slug =
			existing?.blockType ??
			(target.addedValue as { blockType?: string } | undefined)?.blockType;

		if (!field || slug === undefined) {
			throw new Error(
				`Cannot tell which block "${match.descriptor.path}/${index}" is. Supply a "blockType" on the value, one of: ${field ? blockSlugsOf(field).join(", ") : ""}`,
			);
		}

		const block = blockOf(config, field, slug);

		if (!block) {
			throw new Error(
				`"${slug}" is not allowed at "${match.descriptor.path}". Allowed: ${blockSlugsOf(field).join(", ")}`,
			);
		}

		blockType = slug;
		fields = block.flattenedFields;
		data = existing;
		segments = remaining;
	}

	return {
		...(blockType === undefined ? {} : { blockType }),
		fields,
		prefix: "",
	};
};

export { pointerSegments, resolveDataPointer };
export type { PointerResolution };
