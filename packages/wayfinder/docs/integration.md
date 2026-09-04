# Integration

Four steps: register the plugin, load the mapping, wire a catch-all route, and give linkable
collections a `defaultPopulate`.

## 1. Register the plugin

```ts
// payload.config.ts
import { wayfinderPlugin } from "@abinnovision/payloadcms-wayfinder/config";
import { buildConfig } from "payload";

export default buildConfig({
  // ...
  plugins: [
    wayfinderPlugin({
      linkableCollections: ["pages", "articles"],
      adminGroup: "Settings",
    }),
  ],
});
```

| Option                         | Default                 | Purpose                                                                                 |
| ------------------------------ | ----------------------- | --------------------------------------------------------------------------------------- |
| `globalSlug`                   | `"collections-mapping"` | slug of the mapping global                                                              |
| `localized`                    | `true`                  | whether patterns differ per locale; turn off for a project with no `localization` block |
| `identifierField`              | `"slug"`                | fallback identifier for relationship parameters                                         |
| `label`                        | `"Collections Mapping"` | the global's admin label                                                                |
| `adminGroup`                   | `"Settings"`            | the admin sidebar group                                                                 |
| `access`                       | Payload's default       | access control on the global                                                            |
| `interfaceName`                | unset                   | generated-type name for the array rows                                                  |
| `onChange`                     | unset                   | called after the mapping is saved, for cache invalidation                               |
| `linkableCollections`          | `[]`                    | collections checked for `defaultPopulate` at boot                                       |
| `resolvesReferencesExternally` | `false`                 | suppresses that check for a project resolving references its own way                    |
| `quiet`                        | `false`                 | silences the startup checks                                                             |

`localized` and `globalSlug` have to match what `loadMappings` is told. The plugin is the one place
they are decided, so pass the same values to both or leave both at their defaults.

If you do not want the plugin, `createMappingGlobal` takes the same mapping-global options and
returns the `GlobalConfig` for you to place yourself. It does not register the admin translations;
see [`limitations.md`](./limitations.md#translations-only-come-with-the-plugin).

## 2. Load the mapping

`loadMappings` reads the global and compiles it. It is the only function in the package that talks
to the global; everything else takes the result as data.

```ts
import { loadMappings } from "@abinnovision/payloadcms-wayfinder/config";

const mappings = await loadMappings({ payload });
```

| Argument     | Default                 | Purpose                                        |
| ------------ | ----------------------- | ---------------------------------------------- |
| `payload`    | required                | the Payload instance to read through           |
| `globalSlug` | `"collections-mapping"` | must match the plugin                          |
| `localized`  | `true`                  | must match the plugin                          |
| `cache`      | an in-process memo      | where compiled mappings are kept between reads |

It never throws. A global that has never been saved returns an empty list, which is the state every
project is in on its first boot. A row with no collection, a pattern that will not parse, and a
locale with no pattern are each skipped. Routing degrades to "nothing matches" rather than
crashing on the way to the admin panel where an editor would fix it.

### The cache adapter seam

`cache` is a two-method interface:

```ts
export interface MappingCache {
  get: (key: string) => PayloadCollectionMappingResolved[] | undefined;
  set: (key: string, value: PayloadCollectionMappingResolved[]) => void;
}
```

What it caches is compilation, not the read. The key is computed from what the read returned, so
`loadMappings` always performs the `findGlobal` and then avoids recompiling patterns it has already
compiled for that exact content. The default is a process-lifetime `Map`, shared by every call that
does not pass its own.

Supply an adapter to move that store somewhere you control:

```ts
const mappings = await loadMappings({
  payload,
  cache: {
    get: (key) => myStore.get(key),
    set: (key, value) => myStore.set(key, value),
  },
});
```

To skip the read as well, cache your own call to `loadMappings` in whatever request or data cache
your framework provides, and invalidate it from the global's `onChange` hook:

```ts
wayfinderPlugin({
  onChange: () => revalidateTag("wayfinder-mappings"),
});
```

[`recipes.md`](./recipes.md#request-scoped-mappings) shows the request-scoped shape.

## 3. Wire a catch-all route

`resolvePathToDocument` takes the path verbatim and returns the document behind it, or `null`.

```tsx
// app/[[...path]]/page.tsx
import { resolvePathToDocument } from "@abinnovision/payloadcms-wayfinder";
import { loadMappings } from "@abinnovision/payloadcms-wayfinder/config";
import { notFound } from "next/navigation";
import { getPayload } from "payload";

import config from "@payload-config";

const Page = async ({
  params,
}: {
  params: Promise<{ path?: string[]; locale: string }>;
}) => {
  const { path, locale } = await params;
  const payload = await getPayload({ config });
  const mappings = await loadMappings({ payload });

  const resolved = await resolvePathToDocument({
    payload,
    mappings,
    path: `/${(path ?? []).join("/")}`,
    locale,
    draft: false,
  });

  if (!resolved) {
    notFound();
  }

  // resolved.collection is the winning collection, resolved.document the row,
  // resolved.match the identifier and scope the path produced.
  return <Document collection={resolved.collection} data={resolved.document} />;
};

export default Page;
```

| Argument          | Default  | Purpose                                                          |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `payload`         | required | the instance to query                                            |
| `mappings`        | required | compiled mappings                                                |
| `path`            | required | the request path, matched verbatim                               |
| `locale`          | required | which locale's pattern to use                                    |
| `draft`           | `false`  | read drafts; ignored for collections without versions            |
| `depth`           | `10`     | query depth; generous because blocks nest and read relationships |
| `identifierField` | `"slug"` | fallback identifier for relationship parameters                  |
| `where`           | unset    | extra conditions ANDed into the lookup                           |
| `onDiagnostic`    | unset    | why a path produced nothing                                      |

`where` takes a `Where` object or a function of `{ collection, match, draft }`. Access rules,
tenancy and language visibility all narrow which document a path may resolve to and none of them
belong to the package, so this is the seam for them:

```ts
where: ({ collection }) =>
  collection === "articles" ? { hidden: { not_equals: true } } : undefined;
```

The lookup runs with `overrideAccess: true`, because public rendering is not an authenticated read.
Gate visibility through `where`, not through collection access control.

Candidates are tried in specificity order and the first with a document wins, so a path that fits
both a specific pattern and a wildcard resolves to whichever one actually has content. See
[`concepts.md`](./concepts.md#specificity-and-multi-candidate-fallback).

## 4. Sitemaps and feeds with `buildPath`

A sitemap runs outside a request's rendering context and selects only the fields it needs, so it
never holds a document shaped the way `buildHref` expects. It does hold the values, which is all a
pattern needs:

```ts
import { buildPath } from "@abinnovision/payloadcms-wayfinder";

const articles = await payload.find({
  collection: "articles",
  locale: "en",
  depth: 0,
  limit: 0,
  select: { slug: true, section: true, updatedAt: true },
});

const urls = articles.docs.map((doc) => ({
  loc: buildPath({
    mappings,
    collection: "articles",
    locale: "en",
    // Positional: pattern order, no need to know the parameter names.
    values: [String(doc.section ?? ""), String(doc.slug ?? "")],
  }),
  lastmod: doc.updatedAt,
}));
```

`values` also accepts a record keyed by parameter name when you would rather be explicit:

```ts
values: { section: "legal", slug: "imprint" };
```

`buildPath` returns a string, never `null`. An unmapped collection falls back to the site root:
emitting a bare root into a feed is recoverable, emitting an empty href is not. Pass
`onDiagnostic` if you want to hear about it.

## 5. `defaultPopulate` on linkable collections

Declare `defaultPopulate` on every collection that can be the target of a link:

```ts
// collections/articles.ts
export const articles: CollectionConfig = {
  slug: "articles",
  defaultPopulate: { slug: true, section: true, title: true },
  // ...
};
```

This is a prerequisite, not a tuning knob. A reference resolves off the populated document:
`resolveLink` reads `link.reference.value`, and when that value is still a bare id string there is
nothing to route, so the link renders as nothing.

The reason it has to be `defaultPopulate` rather than a `maxDepth` on the relationship is how
Payload measures depth. Depth is counted from the query root, not from the field. A link authored
inside a referenced block — every header and footer link, every link in a reusable section — is
already several levels down by the time its relationship is reached, so any `maxDepth` low enough
to be worth setting also silently un-populates exactly those links. The field ships without a
`maxDepth` for that reason. `defaultPopulate` instead makes a populated target a handful of fields,
so the query's own depth is the only bound and the populated document stays cheap.

`wayfinderPlugin` warns at boot for any collection in `linkableCollections` that has no
`defaultPopulate`. If your project resolves references through its own id-to-path index rather than
a populated document, set `resolvesReferencesExternally: true` to suppress the warning and pass
`resolveReference` to `resolveLink` ([`linking.md`](./linking.md#resolving-references-without-population)).
