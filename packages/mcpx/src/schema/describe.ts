import {
	blockOf,
	blockSlugsOf,
	describeFields,
	findBlocksField,
	joinPath,
	splitPath,
	targetOf,
} from "./walk.js";

import type { FieldDescriptor, SchemaTarget, TargetRef } from "./walk.js";
import type { FlattenedField, SanitizedConfig } from "payload";

/**
 * A collection root or a single block, described without inlining anything
 * reachable through a blocks field.
 */
interface NodeDescriptor {
	blockType?: string;
	/** Set when the node belongs to a collection. */
	collection?: string;
	/** Set when the node belongs to a global. */
	global?: string;
	fields: FieldDescriptor[];
	/** Ready-to-use schema paths for every block this node's fields accept. */
	next?: string[];
	schemaPath: string;
}

const blocksDescriptors = (fields: FlattenedField[]): FieldDescriptor[] =>
	describeFields(fields).filter((descriptor) => descriptor.type === "blocks");

/**
 * Walks a schema path to the field list it addresses.
 *
 * A schema path alternates a blocks field's own path with the slug of one of
 * the blocks it accepts, so `/layout/sections/sectionWrapper/modules/hero`
 * reaches `hero` as it exists under `pages` specifically. The slug sits where
 * a pointer into a document would carry the element's index.
 */
const fieldsAtSchemaPath = (
	config: SanitizedConfig,
	target: SchemaTarget,
	schemaPath: string,
): { blockType?: string; fields: FlattenedField[] } => {
	let fields = target.flattenedFields;
	let blockType: string | undefined;
	let remaining = splitPath(schemaPath);

	while (remaining.length > 0) {
		/**
		 * A blocks field's own path may span several segments
		 * (`/layout/sections`), so the longest matching one is taken.
		 */
		const match = blocksDescriptors(fields)
			.map((descriptor) => splitPath(descriptor.path))
			.filter((parts) =>
				parts.every((part, offset) => part === remaining[offset]),
			)
			.sort((left, right) => right.length - left.length)[0];

		if (!match) {
			throw new Error(
				`"${joinPath(remaining)}" does not address a blocks field. Blocks fields here: ${
					blocksDescriptors(fields)
						.map((descriptor) => descriptor.path)
						.join(", ") || "none"
				}`,
			);
		}

		const slug = remaining.at(match.length);
		const field = findBlocksField(fields, match);

		if (!field) {
			throw new Error(`"${joinPath(match)}" could not be resolved.`);
		}

		if (slug === undefined) {
			throw new Error(
				`"${joinPath(match)}" is a blocks field; append one of: ${blockSlugsOf(field).join(", ")}`,
			);
		}

		const block = blockOf(config, field, slug);

		if (!block) {
			throw new Error(
				`"${slug}" is not allowed at "${joinPath(match)}". Allowed: ${blockSlugsOf(field).join(", ")}`,
			);
		}

		fields = block.flattenedFields;
		blockType = slug;
		remaining = remaining.slice(match.length + 1);
	}

	return { ...(blockType === undefined ? {} : { blockType }), fields };
};

/**
 * Describes a collection or global root, or one block reached through a schema
 * path.
 */
const describeNode = (
	config: SanitizedConfig,
	ref: TargetRef,
	schemaPath = "",
): NodeDescriptor => {
	const { blockType, fields } = fieldsAtSchemaPath(
		config,
		targetOf(config, ref),
		schemaPath,
	);

	const descriptors = describeFields(fields);
	const next = descriptors.flatMap((descriptor) =>
		(descriptor.blocks ?? []).map(
			(slug) => `${schemaPath}${descriptor.path}/${slug}`,
		),
	);

	return {
		...(blockType === undefined ? {} : { blockType }),
		...(ref.kind === "collection"
			? { collection: ref.slug }
			: { global: ref.slug }),
		fields: descriptors,
		...(next.length > 0 ? { next } : {}),
		schemaPath,
	};
};

/**
 * Ceiling on the paths `reachableSchemaPaths` enumerates. The cycle guard only
 * bounds each individual path, so mutually referencing blocks can otherwise
 * explode into permutations. Far beyond any real content model.
 */
const REACHABLE_PATHS_LIMIT = 400;

/**
 * Every schema path reachable from an entity root, capped at
 * {@link REACHABLE_PATHS_LIMIT}. `truncated` tells the caller the cap was hit
 * and explicit paths are the way to go deeper.
 */
const reachableSchemaPaths = (
	config: SanitizedConfig,
	ref: TargetRef,
): { paths: string[]; truncated: boolean } => {
	const seen: string[] = [];
	let truncated = false;

	const walk = (schemaPath: string, visited: readonly string[]): void => {
		if (seen.length >= REACHABLE_PATHS_LIMIT) {
			truncated = true;

			return;
		}

		seen.push(schemaPath);

		for (const descriptor of describeNode(config, ref, schemaPath).fields) {
			for (const slug of descriptor.blocks ?? []) {
				if (visited.includes(slug)) {
					continue;
				}

				walk(`${schemaPath}${descriptor.path}/${slug}`, [...visited, slug]);
			}
		}
	};

	walk("", []);

	return { paths: seen, truncated };
};

export { describeNode, reachableSchemaPaths, REACHABLE_PATHS_LIMIT };
