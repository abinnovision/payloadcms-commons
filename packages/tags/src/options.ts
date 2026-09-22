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
 * `clientProps` for `TagsField`, the only place the field learns which
 * collection holds the tags and which of its fields is the title: neither is
 * derivable from the relationship field's own config alone.
 */
export interface TagsFieldClientProps {
	tagsSlug: string;
	titleField: string;
	presets: readonly string[];
}

/**
 * `clientProps` shared by `TagsCell` and `TagTitleCell`.
 */
export interface TagsCellClientProps {
	tagsSlug: string;
	titleField: string;
}

/**
 * `clientProps` for `ColorField`: the swatches to offer, and the title field
 * whose value previews the name-derived default while no color is set.
 */
export interface ColorFieldClientProps {
	titleField: string;
	presets: readonly string[];
}
