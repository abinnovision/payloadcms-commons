import {
	PRESETS,
	TAGS_CELL_COMPONENT,
	TAGS_FIELD_COMPONENT,
} from "../index.js";
import { mergeTagsTranslations } from "./i18n.js";
import {
	adoptTagsCollection,
	findTitleField,
	generateTagsCollection,
} from "./tags-collection.js";

import type { TagsCellClientProps, TagsFieldClientProps } from "../index.js";
import type { CollectionConfig, Config, Field, Plugin } from "payload";

export interface TagsPluginArgs {
	/** Collections that get the tags relationship field. */
	collections: string[];
	/** The relationship field's name on each tagged collection. Defaults to `"tags"`. */
	fieldName?: string;
	/**
	 * Slug of the tags collection. An existing collection with this slug is
	 * adopted; if none exists, one is generated. Defaults to `"tags"`.
	 */
	tagsSlug?: string;
	/**
	 * Whether tagged collections get the custom, creatable field. `false`
	 * swaps only the list Cell and leaves the stock relationship field (and
	 * its drawer create) in place.
	 */
	allowInlineCreate?: boolean;
	/** Color swatches offered by `ColorField`. Defaults to the package's 12 presets. */
	presets?: string[];
}

const isRelationshipField = (
	field: CollectionConfig["fields"][number],
): field is Extract<
	CollectionConfig["fields"][number],
	{ type: "relationship" }
> => field.type === "relationship";

/**
 * Adds or upgrades the tags relationship field on one tagged collection.
 *
 * An existing top-level field named `fieldName` must already be a `hasMany`
 * relationship to the tags collection; only its `admin.components` are
 * touched, so `access`, `hooks`, `validate`, `filterOptions`, `defaultValue`
 * and `condition` all survive untouched. A missing field is appended to the
 * sidebar instead.
 */
const transformTaggedCollection = (
	collection: CollectionConfig,
	ctx: {
		fieldName: string;
		tagsSlug: string;
		titleField: string;
		allowInlineCreate: boolean;
		presets: readonly string[];
		warn: (message: string) => void;
	},
): CollectionConfig => {
	const fieldClientProps: TagsFieldClientProps = {
		tagsSlug: ctx.tagsSlug,
		titleField: ctx.titleField,
		presets: ctx.presets,
	};
	const cellClientProps: TagsCellClientProps = {
		tagsSlug: ctx.tagsSlug,
		titleField: ctx.titleField,
	};

	const components = ctx.allowInlineCreate
		? {
				Field: { path: TAGS_FIELD_COMPONENT, clientProps: fieldClientProps },
				Cell: { path: TAGS_CELL_COMPONENT, clientProps: cellClientProps },
			}
		: { Cell: { path: TAGS_CELL_COMPONENT, clientProps: cellClientProps } };

	const existing = collection.fields.find(
		(field) => "name" in field && field.name === ctx.fieldName,
	);

	if (existing === undefined) {
		const field: Field = {
			name: ctx.fieldName,
			type: "relationship",
			relationTo: ctx.tagsSlug,
			hasMany: true,
			admin: { position: "sidebar", components },
		};

		return { ...collection, fields: [...collection.fields, field] };
	}

	if (
		!isRelationshipField(existing) ||
		existing.relationTo !== ctx.tagsSlug ||
		!existing.hasMany
	) {
		throw new Error(
			`tagsPlugin: field "${ctx.fieldName}" on collection "${collection.slug}" must be a \`hasMany\` relationship to "${ctx.tagsSlug}".`,
		);
	}

	if (ctx.allowInlineCreate) {
		const unsupported = [
			existing.filterOptions && "filterOptions",
			existing.admin?.appearance && "admin.appearance",
			existing.admin?.sortOptions && "admin.sortOptions",
		].filter((prop): prop is string => Boolean(prop));

		if (unsupported.length > 0) {
			ctx.warn(
				`tagsPlugin: collection "${collection.slug}" sets ${unsupported.map((prop) => `\`${prop}\``).join(", ")} on "${ctx.fieldName}", which the custom field does not honor in the UI (the server still enforces \`filterOptions\`).`,
			);
		}
	}

	const updated = {
		...existing,
		admin: {
			...existing.admin,
			components: { ...existing.admin?.components, ...components },
		},
	} as unknown as Field;

	return {
		...collection,
		fields: collection.fields.map((field) =>
			field === existing ? updated : field,
		),
	};
};

/**
 * Adds inline-creatable, colored tags on top of a native `hasMany`
 * relationship: adopts or generates a tags collection, and wires the
 * relationship field on every collection named in `collections`.
 */
export const tagsPlugin = (args: TagsPluginArgs): Plugin => {
	const fieldName = args.fieldName ?? "tags";
	const tagsSlug = args.tagsSlug ?? "tags";
	const allowInlineCreate = args.allowInlineCreate ?? true;
	const presets = args.presets ?? PRESETS;

	const plugin: Plugin = (config: Config): Config => {
		const collections = config.collections ?? [];

		for (const slug of args.collections) {
			if (!collections.some((collection) => collection.slug === slug)) {
				throw new Error(`tagsPlugin: unknown collection "${slug}".`);
			}
		}

		const warnings: string[] = [];
		const warn = (message: string): void => {
			warnings.push(message);
		};

		const existingTags = collections.find(
			(collection) => collection.slug === tagsSlug,
		);

		let tagsCollection: CollectionConfig;
		if (existingTags) {
			const { collection, forcedSelectApiOff } = adoptTagsCollection(
				existingTags,
				presets,
			);
			if (forcedSelectApiOff) {
				warn(
					`tagsPlugin: collection "${tagsSlug}" had \`admin.enableListViewSelectAPI: true\`, which the tags field needs off to read full tag documents. It has been forced to \`false\`.`,
				);
			}

			tagsCollection = collection;
		} else {
			tagsCollection = generateTagsCollection(tagsSlug, presets);
		}

		const titleField = findTitleField(tagsCollection).name;

		const nextCollections = collections.map((collection) => {
			if (collection.slug === tagsSlug) {
				return tagsCollection;
			}

			if (args.collections.includes(collection.slug)) {
				return transformTaggedCollection(collection, {
					fieldName,
					tagsSlug,
					titleField,
					allowInlineCreate,
					presets,
					warn,
				});
			}

			return collection;
		});

		if (!existingTags) {
			nextCollections.push(tagsCollection);
		}

		const existingOnInit = config.onInit;

		return {
			...config,
			collections: nextCollections,
			i18n: {
				...config.i18n,
				translations: mergeTagsTranslations(config.i18n?.translations),
			},
			onInit: async (payload) => {
				if (existingOnInit) {
					await existingOnInit(payload);
				}

				for (const message of warnings) {
					payload.logger.warn(message);
				}
			},
		};
	};

	plugin.slug = "tags";

	return plugin;
};
