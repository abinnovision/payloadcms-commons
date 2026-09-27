# @abinnovision/payloadcms-tags

Flat, colored tags for [Payload CMS](https://payloadcms.com/) documents, as a lighter
alternative to folders.

The plugin generates its own tags collection and adds a `hasMany` relationship field to
each collection you list. Tags are created by typing into the field instead of opening a
drawer, and each tag carries a color rendered as a pill wherever tags show up, in both
admin themes.

## Install

```sh
yarn add @abinnovision/payloadcms-tags
```

Peers: `payload >=3.88.0 <4` and `react ^19`. `@payloadcms/ui` is an optional peer, needed
only by the `./admin` entrypoint.

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

## What it adds

- A tags collection (slug configurable, default `"tags"`) with a `name` field as its title
  and a `color` field, and Payload's default access.
- A `hasMany` relationship field (name configurable, default `"tags"`) in the sidebar of
  each collection named in `collections`.
- Inline creation: typing a name that does not exist creates the tag without leaving the
  field, using Payload's built-in "Create" option.
- Colored pills, in the field itself and in list views, built from Payload's own theme
  variables so they read correctly in both light and dark admin themes.

The plugin generates the tags collection and the tags fields itself. It throws a config
error, prefixed `[payloadcms-tags]`, if a collection with the tags slug already exists, or if
a collection named in `collections` already has a top-level field named `fieldName`.

## Options

```ts
tagsPlugin({
  collections, // required: collections that get the tags field
  fieldName, // the field's name on each tagged collection; defaults to "tags"
  tagsSlug, // slug of the generated tags collection; defaults to "tags"
  allowInlineCreate, // whether tagged collections get the creatable field; defaults to true
  presets, // color swatches offered by the color field; defaults to the package's 12 presets
  overrides, // transforms the generated tags collection before it is registered
});
```

| Option              | Meaning                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `collections`       | Required. Collections that get the tags relationship field.                                                                                      |
| `fieldName`         | The relationship field's name on each tagged collection. Defaults to `"tags"`.                                                                   |
| `tagsSlug`          | Slug of the generated tags collection. Defaults to `"tags"`.                                                                                     |
| `allowInlineCreate` | Whether tagged collections get the custom, creatable field. `false` keeps Payload's stock relationship field, and only the list cell is swapped. |
| `presets`           | Color swatches offered by the color field. Defaults to the package's 12 presets.                                                                 |
| `overrides`         | Receives the generated tags collection and returns the one to register: access, `admin.group`, labels, extra fields.                             |

### `overrides`

Restrict who can create tags and group the collection in the admin sidebar:

```ts
tagsPlugin({
  collections: ["posts", "pages"],
  overrides: (collection) => ({
    ...collection,
    admin: { ...collection.admin, group: "Taxonomy" },
    access: {
      ...collection.access,
      create: ({ req }) => req.user?.role === "editor",
    },
  }),
});
```

## Colors

Any hex color is accepted, not just the 12 presets offered by the color field: a project
may already have brand colors it wants its tags to carry. A tag saved without an explicit
color gets a deterministic default, hashed from its name, so the same tag always renders
the same color.

Pills are built from Payload's own theme variables rather than fixed colors, so a tag
reads correctly in both light and dark admin themes without per-theme configuration.

## Limitations

- The custom field does not support Payload's relationship drawer edit, the
  `filterOptions` UI, `sortOptions` or paging.
- All tags are loaded client-side, once, on mount. This is sized for a vocabulary of a few
  hundred tags, not for pagination-scale lists.
- Tags created inline in a draft that is later abandoned stay behind unused.
- On MongoDB, deleting a tag leaves its id in documents that referenced it.
- The case-insensitive duplicate check runs in a `beforeValidate` hook, not a database
  constraint, so it has a race window under concurrent writes. On SQLite, the pre-filter
  case folding is ASCII-only, so non-ASCII names such as `Äpfel` and `äpfel` are not
  recognized as duplicates there.

Register `tagsPlugin` before any plugin that references the tags collection by slug, for
example mcpx exposing it: the collection only exists once `tagsPlugin` has run.

## Entrypoints

```
.          The shared color, search, selection and permission helpers, and the
           list-cell model. Free of React and of the Payload runtime, because it
           is reached from the config graph and from the admin bundle alike.

./config   `tagsPlugin`. Loaded by `payload generate:types`, migrations and the
           CLI, so it stays free of React.

./admin    The field and cell components, referenced by import path from the
           collections the plugin configures. Run `payload generate:importmap`
           after adding the plugin so Payload can resolve them.
```

## License

Apache-2.0
