# @abinnovision/payloadcms-tags

Flat, colored tags for [Payload CMS](https://payloadcms.com/) documents, as a lighter
alternative to folders.

The plugin keeps the native `hasMany` relationship storage and adds what it is missing:
tags created by typing into the field instead of opening a drawer, and a per-tag color
rendered as a pill wherever tags show up, in both admin themes.

## Install

```sh
yarn add @abinnovision/payloadcms-tags
```

Peers: `payload >=3.88.0 <4`, `react ^19`, `react-dom ^19`. `@payloadcms/ui` is an optional
peer, needed only by the `./admin` entrypoint.

## Setup

Add the plugin in `payload.config.ts`, naming the collections that get the tags field:

```ts
// payload.config.ts
import { tagsPlugin } from "@abinnovision/payloadcms-tags/config";
import { buildConfig } from "payload";

export default buildConfig({
  // ...
  plugins: [tagsPlugin({ collections: ["posts", "pages"] })],
});
```

Then run `payload generate:importmap`, as for any plugin that contributes admin
components. Payload resolves the field and cell components by import path, so they have to
be in the generated map.

## Options

```ts
tagsPlugin({
  collections, // required: collections that get the tags field
  fieldName, // the field's name on each tagged collection; defaults to "tags"
  tagsSlug, // slug of the tags collection; defaults to "tags"
  allowInlineCreate, // whether tagged collections get the creatable field; defaults to true
  presets, // color swatches offered by the color field; defaults to the package's 12 presets
});
```

| Option              | Meaning                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collections`       | Required. Collections that get the tags relationship field.                                                                                                            |
| `fieldName`         | The relationship field's name on each tagged collection. Defaults to `"tags"`.                                                                                         |
| `tagsSlug`          | Slug of the tags collection. An existing collection with this slug is adopted; if none exists, one is generated. Defaults to `"tags"`.                                 |
| `allowInlineCreate` | Whether tagged collections get the custom, creatable field. `false` swaps only the list cell and leaves the stock relationship field, and its drawer create, in place. |
| `presets`           | Color swatches offered by the color field. Defaults to the package's 12 presets.                                                                                       |

## Adopting an existing tags collection

If a collection with `tagsSlug` already exists, it is adopted in place rather than
replaced:

- It must set `admin.useAsTitle` to a top-level `text` field. A missing or wrong-shaped
  title field throws at config time.
- A nullable `color` column is added if the collection does not already have one. Existing
  rows keep working; a missing color falls back to a name-hashed default at render time.
  If the collection already has a top-level `color` field, it is left as-is and no second
  field is added; it must be of type `text`, or the plugin throws at config time.
- The duplicate-title and color-fill hooks are prepended ahead of any hooks the collection
  already defines, so a project's own `beforeValidate`/`beforeChange` hooks still run
  afterward.
- `admin.enableListViewSelectAPI` is forced to `false`. The tags field needs full tag
  documents, not just the title Payload's list view would otherwise limit it to.
- Access rules, other fields, `unique` constraints and indexes are left untouched.
- The duplicate check runs on create, and on update only when the trimmed title actually
  changed, so an existing `News`/`news` pair stays editable without tripping over itself.
- If the title field is `localized`, the duplicate check runs per locale.

If no collection with `tagsSlug` exists, one is generated: a required, unique, indexed
`name` field plus the same `color` field and hooks, and Payload's default access.

## Tagged collections

For each collection named in `collections`, Payload's own `DuplicateFieldName` check
applies as usual, so `fieldName` cannot collide with a field nested in a `row` or
`collapsible`.

If a top-level field named `fieldName` already exists, it must be a `hasMany` relationship
to the tags collection; only its `admin.components` are changed, so `access`, `hooks`,
`validate`, `filterOptions`, `defaultValue` and `condition` all survive untouched. With
`allowInlineCreate: false`, only the list `Cell` is swapped and the stock field (including
its drawer create) is kept.

If the field does not exist, it is appended to the sidebar as a `hasMany` relationship.

## Colors

Any hex color is accepted, not just the 12 presets offered by the color field: a project
may already have brand colors it wants its tags to carry. A tag saved without an explicit
color gets a deterministic default, hashed from its title, so the same tag always renders
the same color.

Pills are built from Payload's own theme variables rather than fixed colors, so a tag
reads correctly in both light and dark admin themes without per-theme configuration.

## Limitations

- The custom field's UI does not honor `filterOptions`, the edit drawer, `appearance`,
  `sortOptions` or paging. The server still validates `filterOptions` on save; only the
  field's own UI ignores it.
- Tags are loaded client-side, once, on mount. This is sized for a vocabulary of a few
  hundred tags, not for pagination-scale lists.
- Tags created inline in a draft that is later abandoned stay behind unused. On MongoDB,
  deleting a tag leaves its id in documents that referenced it.
- The case-insensitive duplicate check runs in a `beforeValidate` hook, not a database
  constraint, so it has a race window under concurrent writes. On SQLite, the pre-filter
  case folding is ASCII-only, so non-ASCII titles such as `Äpfel` and `äpfel` are not
  recognized as duplicates there.
- Register `tagsPlugin` before plugins that validate collection slugs, when it is the one
  generating the tags collection: a plugin reading `config.collections` earlier in the
  chain would not see it yet. The same ordering applies to a plugin that replaces
  `config.i18n.translations` wholesale instead of merging into it: it must run before
  `tagsPlugin` too, or it will discard the translations `tagsPlugin` added.

## License

Apache-2.0
