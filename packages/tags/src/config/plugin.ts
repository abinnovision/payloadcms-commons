import { InvalidConfiguration } from "payload";

import {
	PRESETS,
	TAGS_CELL_COMPONENT,
	TAGS_FIELD_COMPONENT,
} from "../index.js";
import { buildTagsCollection } from "./tags-collection.js";

import type { TagsCellClientProps, TagsFieldClientProps } from "../index.js";
import type {
	CollectionConfig,
	Config,
	Plugin,
	RelationshipField,
} from "payload";

export interface TagsPluginArgs {
	/** Collections that get the tags field. */
	collections: readonly string[];
	/** Name of the relationship field added to each tagged collection. Default "tags". */
	fieldName?: string | undefined;
	/** Slug of the generated tags collection. Default "tags". */
	tagsSlug?: string | undefined;
	/** false keeps Payload's stock relationship field and only swaps the list cell. Default true. */
	allowInlineCreate?: boolean | undefined;
	/** Preset swatches. Default PRESETS. */
	presets?: readonly string[] | undefined;
	/** Receives the generated tags collection and returns the one to register (access, admin group, labels, extra fields). */
	overrides?: ((collection: CollectionConfig) => CollectionConfig) | undefined;
}

const fail = (message: string): never => {
	throw new InvalidConfiguration(`[payloadcms-tags] ${message}`);
};

/**
 * The relationship field appended to a tagged collection. Built once per
 * collection, since Payload sanitizes field objects in place.
 */
const tagsField = (args: {
	fieldName: string;
	tagsSlug: string;
	allowInlineCreate: boolean;
}): RelationshipField => {
	const fieldClientProps: TagsFieldClientProps = { tagsSlug: args.tagsSlug };
	const cellClientProps: TagsCellClientProps = { tagsSlug: args.tagsSlug };
	const Cell = { path: TAGS_CELL_COMPONENT, clientProps: cellClientProps };

	return {
		name: args.fieldName,
		type: "relationship",
		relationTo: args.tagsSlug,
		hasMany: true,
		admin: {
			position: "sidebar",
			components: args.allowInlineCreate
				? {
						Field: {
							path: TAGS_FIELD_COMPONENT,
							clientProps: fieldClientProps,
						},
						Cell,
					}
				: { Cell },
		},
	};
};

/**
 * Generates a tags collection and adds a `hasMany` relationship to it on
 * every collection named in `collections`.
 */
export const tagsPlugin = (args: TagsPluginArgs): Plugin => {
	const fieldName = args.fieldName ?? "tags";
	const tagsSlug = args.tagsSlug ?? "tags";
	const allowInlineCreate = args.allowInlineCreate ?? true;

	const plugin: Plugin = (config: Config): Config => {
		const collections = config.collections ?? [];

		if (collections.some((collection) => collection.slug === tagsSlug)) {
			fail(
				`A collection with the slug "${tagsSlug}" already exists. The plugin generates it; use \`overrides\` to customize it, or pick another \`tagsSlug\`.`,
			);
		}

		for (const slug of args.collections) {
			if (slug === tagsSlug) {
				fail(
					`Cannot tag the tags collection itself. Remove "${slug}" from \`collections\`.`,
				);
			}

			const collection = collections.find(
				(candidate) => candidate.slug === slug,
			);

			if (!collection) {
				fail(`Unknown collection "${slug}" in \`collections\`.`);
			} else if (
				collection.fields.some(
					(candidate) => "name" in candidate && candidate.name === fieldName,
				)
			) {
				fail(
					`Collection "${slug}" already has a field named "${fieldName}". The plugin adds it; remove it or pick another \`fieldName\`.`,
				);
			}
		}

		return {
			...config,
			collections: [
				...collections.map((collection) =>
					args.collections.includes(collection.slug)
						? {
								...collection,
								fields: [
									...collection.fields,
									tagsField({ fieldName, tagsSlug, allowInlineCreate }),
								],
							}
						: collection,
				),
				buildTagsCollection({
					slug: tagsSlug,
					presets: args.presets ?? PRESETS,
					overrides: args.overrides,
				}),
			],
		};
	};

	plugin.slug = "tags";

	return plugin;
};
