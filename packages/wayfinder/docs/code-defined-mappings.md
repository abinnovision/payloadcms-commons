# Code-defined mappings

The CMS-authored global is one way to produce mappings. `defineMappings` is the other, and nothing
in the runtime can tell them apart.

```ts
import {
  createRouter,
  defineMappings,
} from "@abinnovision/payloadcms-wayfinder";

const mappings = defineMappings([
  { collection: "pages", path: "/*path" },
  { collection: "articles", path: "/journal/:slug" },
  { collection: "sections", path: "/:slug" },
]);

const router = createRouter({ mappings, locale: "en" });

router.href("articles", { slug: "hello-world" });
// "/journal/hello-world"
```

No plugin, no global, no Payload instance. `defineMappings` compiles the same
`PayloadCollectionMapping[]` shape `loadMappings` produces from the global, and returns the same
`PayloadCollectionMappingResolved[]` a router takes.

Localized patterns work the same way, keyed by locale:

```ts
const mappings = defineMappings([
  {
    collection: "articles",
    path: { en: "/journal/:slug", fr: "/journal/:slug" },
  },
]);
```

A plain string means the project has no locales. It normalises into a single bucket under
`DEFAULT_LOCALE_KEY`, and `resolversFor` falls back to that bucket for any locale, so callers pass
whatever locale they have and still get the right pattern.

## The identifier fallback

A second argument sets what a relationship parameter falls back to when the target collection's own
pattern cannot name an identifier:

```ts
const mappings = defineMappings(rows, { fallbackIdentifierField: "permalink" });
```

It belongs here rather than on a routing call because it does not vary per request: the same answer
is right for every href, every path lookup and every preview URL in the process. Compiling it into
the mappings is what lets it reach all three without being passed to any of them.
Mappings read from the global get it from the plugin instead:
`wayfinderPlugin({ fallbackIdentifierField })` puts it on the global's config and `loadMappings`
reads it back, so the pattern validator and the compiled mappings cannot be told different things.
`loadMappings` takes the argument too, to override that. Left unset everywhere, it is `"slug"`.

## Why the runtime works this way

A router takes `mappings` as data rather than reading the global itself. That was the first decision
in the package, and it is what makes this file short.

If the runtime read the global, `router.href` would need a `Payload` instance and would become
async. A sitemap generator would boot Payload to format a URL. A unit test of pattern behaviour
would need a database. Preview and production would share a hidden singleton that one of them populated first.
Passing the data in removes all of that: the read is one function, `loadMappings`, called wherever
the caller decides, and everything downstream is pure.

The side effect is that the global stops being privileged. It is a source of mapping data, not the
source, so code can supply the same data directly.

## When to prefer it

**Routing that does not change.** If URLs are a product decision rather than an editorial one,
putting the map in code makes it reviewable, diffable and deployable with the rest of the routing.
An editor cannot break a URL scheme they cannot edit.

**No admin panel.** A headless consumer, a static export, a migration script or a separate service
that renders Payload content may not run the admin at all. `defineMappings` needs nothing but the
patterns.

**Tests.** A test of link resolution or path matching wants a fixed map, not a seeded global:

```ts
import {
  createRouter,
  defineMappings,
} from "@abinnovision/payloadcms-wayfinder";
import { describe, expect, it } from "vitest";

describe("link resolution", () => {
  const router = createRouter({
    mappings: defineMappings([
      { collection: "articles", path: "/journal/:slug" },
    ]),
    locale: "en",
  });

  it("routes a reference through the mapping", () => {
    // As a populated reference arrives: the id, plus whatever was selected.
    const article = { id: "1", slug: "hello-world" };

    const resolved = router.link({
      type: "reference",
      reference: { relationTo: "articles", value: article },
    });

    expect(resolved).toEqual({ href: "/journal/hello-world" });
  });
});
```

**Per-tenant routing.** The mapping global is a singleton, so a multi-tenant project cannot author
one map per tenant in it. Building each tenant's map in code and selecting it per request works
today; see [`limitations.md`](./limitations.md#one-mapping-per-instance).

## Mixing the two

Both produce the same array, so a project can concatenate them. Fixed routing lives in code,
editorial routing comes from the global:

```ts
const mappings = [
  ...defineMappings([{ collection: "articles", path: "/journal/:slug" }]),
  ...(await loadMappings({ payload })),
];
```

Order matters only for ties that specificity does not break, and duplicate collections are not
rejected here the way the global's validator rejects them: `router.href` and `router.path` take the
first mapping matching a collection, so a code-defined row placed first wins over an authored one
for the same collection. Path matching still considers both.
