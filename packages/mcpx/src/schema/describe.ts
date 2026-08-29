import { lexicalSubSchema, subSchemaNodeTypes } from "./lexical.js";
import {
	blockOf,
	blockSlugsOf,
	describeFields,
	findBlocksField,
	findRichTextField,
	joinPath,
	splitPath,
	targetOf,
} from "./walk.js";
import { translateAny } from "../i18n.js";

import type { Translate } from "../i18n.js";
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

/**
 * One drill-down out of a node: the schema path leading there, and the token
 * {@link reachableSchemaPaths} tracks to stop a definition reachable from
 * itself from being enumerated forever.
 */
interface Branch {
	path: string;
	token: string;
}

/**
 * The longest descriptor path that is a prefix of `remaining`. Blocks and rich
 * text fields are both leaves of the walk, so at most one can match.
 */
const longestMatch = (
	descriptors: FieldDescriptor[],
	remaining: readonly string[],
): string[] | undefined =>
	descriptors
		.map((descriptor) => splitPath(descriptor.path))
		.filter((parts) =>
			parts.every((part, offset) => part === remaining[offset]),
		)
		.sort((left, right) => right.length - left.length)[0];

/**
 * A position mid-walk: the fields in scope, the descriptor path matched there,
 * and the segments still to consume.
 */
interface StepAt {
	config: SanitizedConfig;
	fields: FlattenedField[];
	match: string[];
	remaining: readonly string[];
}

/** Where one step of a schema path lands. */
interface Step {
	blockType?: string;
	fields: FlattenedField[];
	rest: string[];
}

/**
 * Walks one step of a schema path through a blocks field.
 */
const stepThroughBlocks = ({
	config,
	fields,
	match,
	remaining,
}: StepAt): Step => {
	const field = findBlocksField(fields, match);

	if (!field) {
		throw new Error(`"${joinPath(match)}" could not be resolved.`);
	}

	const slug = remaining.at(match.length);

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

	return {
		blockType: slug,
		fields: block.flattenedFields,
		rest: remaining.slice(match.length + 1),
	};
};

/**
 * Walks one step of a schema path into a Lexical node's own fields.
 *
 * A node that picks a block by slug takes one segment more, so `/content/block`
 * addresses the choice and `/content/block/callout` the definition. Everything
 * else, a link node being the usual case, resolves in a single segment.
 */
const stepThroughLexical = ({
	config,
	fields,
	match,
	remaining,
}: StepAt): Step => {
	const field = findRichTextField(fields, match);

	if (!field) {
		throw new Error(`"${joinPath(match)}" could not be resolved.`);
	}

	const available = subSchemaNodeTypes(field).join(", ") || "none";
	const nodeType = remaining.at(match.length);

	if (nodeType === undefined) {
		throw new Error(
			`"${joinPath(match)}" is a rich text field; append one of: ${available}`,
		);
	}

	const sub = lexicalSubSchema(field, nodeType);
	const reached = joinPath([...match, nodeType]);

	if (!sub) {
		throw new Error(
			`"${nodeType}" carries no fields in this field's editor. Node types with fields here: ${available}`,
		);
	}

	if (sub.kind === "fields") {
		return { fields: sub.fields, rest: remaining.slice(match.length + 1) };
	}

	const slug = remaining.at(match.length + 1);
	const slugs = blockSlugsOf(sub.blocksField).join(", ");

	if (slug === undefined) {
		throw new Error(`"${reached}" selects a block; append one of: ${slugs}`);
	}

	const block = blockOf(config, sub.blocksField, slug);

	if (!block) {
		throw new Error(
			`"${slug}" is not allowed at "${reached}". Allowed: ${slugs}`,
		);
	}

	return {
		blockType: slug,
		fields: block.flattenedFields,
		rest: remaining.slice(match.length + 2),
	};
};

/**
 * Walks a schema path to the field list it addresses.
 *
 * A schema path alternates a blocks field's own path with the slug of one of
 * the blocks it accepts, so `/layout/sections/sectionWrapper/modules/hero`
 * reaches `hero` as it exists under `pages` specifically. The slug sits where
 * a pointer into a document would carry the element's index. A rich text
 * field's path continues the same way, naming a Lexical node type and, for the
 * block nodes, the slug it holds.
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
		const descendable = describeFields(fields).filter(
			(descriptor) =>
				descriptor.type === "blocks" || descriptor.type === "richText",
		);

		/**
		 * A field's own path may span several segments (`/layout/sections`), so
		 * the longest matching one is taken. Blocks and rich text fields are both
		 * leaves of the walk, so no two of these paths overlap.
		 */
		const match = longestMatch(descendable, remaining);

		if (!match) {
			throw new Error(
				`"${joinPath(remaining)}" does not address a blocks or rich text field. Available here: ${
					descendable.map((descriptor) => descriptor.path).join(", ") || "none"
				}`,
			);
		}

		const at = { config, fields, match, remaining };
		const step =
			findBlocksField(fields, match) === undefined
				? stepThroughLexical(at)
				: stepThroughBlocks(at);

		blockType = step.blockType;
		fields = step.fields;
		remaining = step.rest;
	}

	return { ...(blockType === undefined ? {} : { blockType }), fields };
};

/**
 * Where a descriptor can be drilled into: one branch per block a blocks field
 * accepts, and one per Lexical node type that carries fields.
 */
const branchesOf = (
	fields: FlattenedField[],
	descriptor: FieldDescriptor,
	schemaPath: string,
): Branch[] => {
	const base = `${schemaPath}${descriptor.path}`;

	if (descriptor.type === "richText") {
		const field = findRichTextField(fields, splitPath(descriptor.path));

		if (!field) {
			return [];
		}

		return subSchemaNodeTypes(field).flatMap((nodeType) => {
			const sub = lexicalSubSchema(field, nodeType);

			if (sub?.kind !== "blocks") {
				return [{ path: `${base}/${nodeType}`, token: `lexical:${nodeType}` }];
			}

			return blockSlugsOf(sub.blocksField).map((slug) => ({
				path: `${base}/${nodeType}/${slug}`,
				token: `lexical:${nodeType}:${slug}`,
			}));
		});
	}

	return (descriptor.blocks ?? []).map((slug) => ({
		path: `${base}/${slug}`,
		token: slug,
	}));
};

/**
 * Describes a collection or global root, one block reached through a schema
 * path, or the fields a Lexical node carries.
 *
 * Curried on the translator that resolves each `admin.description`, so a
 * request binds its language once and the walk itself stays request-free.
 */
export const nodeDescriber =
	(translate: Translate = translateAny) =>
	(
		config: SanitizedConfig,
		ref: TargetRef,
		schemaPath = "",
	): NodeDescriptor => {
		const { blockType, fields } = fieldsAtSchemaPath(
			config,
			targetOf(config, ref),
			schemaPath,
		);

		const descriptors = describeFields(fields, translate);
		const next = descriptors.flatMap((descriptor) =>
			branchesOf(fields, descriptor, schemaPath).map((branch) => branch.path),
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
export const REACHABLE_PATHS_LIMIT = 400;

/**
 * Every schema path reachable from an entity root, capped at
 * {@link REACHABLE_PATHS_LIMIT}. `truncated` tells the caller the cap was hit
 * and explicit paths are the way to go deeper.
 */
export const reachableSchemaPaths = (
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

		const { fields } = fieldsAtSchemaPath(
			config,
			targetOf(config, ref),
			schemaPath,
		);

		for (const descriptor of describeFields(fields)) {
			for (const branch of branchesOf(fields, descriptor, schemaPath)) {
				if (visited.includes(branch.token)) {
					continue;
				}

				walk(branch.path, [...visited, branch.token]);
			}
		}
	};

	walk("", []);

	return { paths: seen, truncated };
};

/** Describes a node without a request in hand, in whichever language comes first. */
export const describeNode = nodeDescriber();
