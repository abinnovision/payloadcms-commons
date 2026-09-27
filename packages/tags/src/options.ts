/**
 * Payload resolves admin components by import path, so these strings have to
 * match the `./admin` package exports. Consumers must run
 * `payload generate:importmap` after adding the plugin, as for any plugin
 * that contributes admin components.
 */
export const TAGS_FIELD_COMPONENT =
	"@abinnovision/payloadcms-tags/admin#TagsField";
export const TAGS_CELL_COMPONENT =
	"@abinnovision/payloadcms-tags/admin#TagsCell";
export const TAG_TITLE_CELL_COMPONENT =
	"@abinnovision/payloadcms-tags/admin#TagTitleCell";
export const COLOR_FIELD_COMPONENT =
	"@abinnovision/payloadcms-tags/admin#ColorField";

/**
 * Field names on the tags collection the plugin generates. The admin
 * components read tags by these names, so they live here rather than in the
 * config layer.
 */
export const TITLE_FIELD = "name";
export const COLOR_FIELD = "color";

/**
 * `clientProps` for `TagsField`: the collection that holds the tags, which the
 * relationship field's own client config does not expose to a custom field.
 */
export interface TagsFieldClientProps {
	tagsSlug: string;
}

/**
 * `clientProps` for `TagsCell`.
 */
export interface TagsCellClientProps {
	tagsSlug: string;
}

/**
 * `clientProps` for `ColorField`: the swatches to offer.
 */
export interface ColorFieldClientProps {
	presets: readonly string[];
}
