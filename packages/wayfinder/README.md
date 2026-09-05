# @abinnovision/payloadcms-wayfinder

![An editor-authored map of path patterns turns collections into URLs and URLs back into documents](https://raw.githubusercontent.com/abinnovision/payloadcms-commons/main/packages/wayfinder/assets/header.png)

Editor-authored URL routing for [Payload CMS](https://payloadcms.com/).

Wayfinder owns one thing: the map from collections to the URL patterns their documents are served
at. That map is authored in the CMS, so adding a page type is an editorial act rather than a code
change. Everything else in the package falls out of it. `createRouter` binds the mapping, the
locale and the href formatter once per request and hands back a router: `router.href` turns a
document into an href, `router.path` builds a path from parameter values alone for sitemaps and
feeds, `router.resolve` turns a request path back into a document for a catch-all route, and
`router.link` plus `linkField` give editors a link that follows its target when that collection's
pattern changes. [`docs/concepts.md`](./docs/concepts.md) describes the model;
[`docs/limitations.md`](./docs/limitations.md) states what is out of scope and why.

## Install

```sh
yarn add @abinnovision/payloadcms-wayfinder
```

Only `payload` is required. Every other peer is optional and pulled in solely by the surface that
uses it, so a project that only needs the URL layer installs nothing else:

| Peer                                 | Range              | Needed for                |
| ------------------------------------ | ------------------ | ------------------------- |
| `payload`                            | `>=3.88.0 <4`      | everything (required)     |
| `@payloadcms/richtext-lexical`       | `>=3.88.0 <4`      | `./lexical` and `./admin` |
| `react`, `lexical`, `@lexical/react` | `^19`, `>=0.35 <1` | `./admin`                 |
| `@payloadcms/ui`                     | `>=3.88.0 <4`      | `./admin`                 |
| `@abinnovision/payloadcms-montage`   | `>=1.0.0-beta.1`   | `./montage`               |

## Setup

Register the plugin in `payload.config.ts`. It adds the mapping global and the package's admin
translations:

```ts
// payload.config.ts
import { wayfinderPlugin } from "@abinnovision/payloadcms-wayfinder/config";
import { buildConfig } from "payload";

export default buildConfig({
  // ...
  plugins: [wayfinderPlugin({ checkDefaultPopulateOn: ["pages", "articles"] })],
});
```

Then open the global in the admin panel and author one row per collection. A row is a collection
slug and a path pattern:

```
pages      /*path
articles   /journal/:slug
sections   /:slug
```

The last parameter of a pattern identifies the document; earlier parameters narrow the lookup. A
pattern is validated on save against the collection's own fields, so a parameter that names
nothing queryable is rejected before it can produce a URL that resolves to nothing.

Read the mapping and hand it to a catch-all route:

```tsx
// app/[[...path]]/page.tsx
import { createRouter } from "@abinnovision/payloadcms-wayfinder";
import { loadMappings } from "@abinnovision/payloadcms-wayfinder/config";
import { notFound } from "next/navigation";
import { getPayload } from "payload";

import config from "@payload-config";

const Page = async ({ params }: { params: Promise<{ path?: string[] }> }) => {
  const payload = await getPayload({ config });
  const mappings = await loadMappings({ payload });
  const { path } = await params;

  const wayfinder = createRouter({ mappings, locale: "en" });

  const resolved = await wayfinder.resolve(`/${(path ?? []).join("/")}`, {
    payload,
  });

  if (!resolved) {
    notFound();
  }

  return <Document collection={resolved.collection} data={resolved.document} />;
};

export default Page;
```

[`docs/integration.md`](./docs/integration.md) covers the rest: caching the mapping, the
`defaultPopulate` prerequisite for linkable collections, and sitemap and feed usage.

## Entrypoints

```
"."          createRouter, defineMappings, defineLinks, resolveRelationshipSlug, deriveLinkLabel, types
"./internal" the unbound functions the router is built out of, plus the pattern internals
"./config"   wayfinderPlugin, createMappingGlobal, loadMappings, linkField
"./lexical"  wayfinderLinkFeature, linkLabelFeature, resolveLinkNode
"./admin"    LinkLabelFeatureClient, mounted by linkLabelFeature through the import map
"./montage"  initWayfinder, wayfinderFrom, wayfinderExtension
```

`.` is the runtime half. It takes mappings as plain data and never reads the CMS, so it runs in a
route handler, a sitemap, a script or a test alike. `./internal` is the escape hatch behind it,
for a caller that holds no request or wants a different set of arguments per call; nothing there
carries a compatibility guarantee. `./config` is loaded by the CLI, by migrations and by
`payload generate:types`, so it must stay React-free. `./lexical`, `./admin` and `./montage` each
pull in an optional peer and are separate for that reason.
[`docs/layers.md`](./docs/layers.md) explains the split.

## Documentation

- [`docs/concepts.md`](./docs/concepts.md): the mapping global, patterns, specificity and the
  wildcard contract.
- [`docs/layers.md`](./docs/layers.md): the three layers, the optional surfaces, and what each one
  works without.
- [`docs/integration.md`](./docs/integration.md): plugin setup, caching, catch-all routes,
  sitemaps and `defaultPopulate`.
- [`docs/linking.md`](./docs/linking.md): `linkField`, `defineLinks`, `router.link` and the Lexical
  feature.
- [`docs/code-defined-mappings.md`](./docs/code-defined-mappings.md): `defineMappings`, with no CMS
  global at all.
- [`docs/recipes.md`](./docs/recipes.md): link components, locale and preview prefixing, admin
  preview URLs, and request-scoped mappings.
- [`docs/limitations.md`](./docs/limitations.md): what wayfinder does not do, and why.

## License

Apache-2.0
