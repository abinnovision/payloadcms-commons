# Concepts

Wayfinder is a map from collections to URL patterns, plus the functions that read it in both
directions. It does not model pages, sections or navigation. It answers two questions: which URL is
this document served at, and which document is served at this URL.

## The mapping global

`wayfinderPlugin` registers one global, `collections-mapping` by default. It holds a single array
field, `collections`, whose rows carry two values:

| Field            | Type                               | Meaning                                     |
| ---------------- | ---------------------------------- | ------------------------------------------- |
| `collectionName` | text, validated against the config | the collection this row routes              |
| `path`           | text, localized by default         | the URL pattern its documents are served at |

`collectionName` is a text field rather than a select. A select would need its options frozen when
the config is built, which would make the field go stale as soon as a collection is added. The text
field validates against the collections actually registered on the running instance instead, and
names the available ones when the value is unknown.

`path` is localized by default, so a project with a `localization` block supplies one pattern per
locale and Payload returns a per-locale record. A project with no locales sets `localized: false`
and supplies one string. Both shapes normalise into the same per-locale record internally; the
unlocalized one lands in a single bucket under the exported `DEFAULT_LOCALE_KEY`.

The array field rejects two rows naming the same collection, and two rows sharing the same pattern.
Two collections on one pattern tie on every specificity measure below, which would leave path
lookups decided by row order and href building decided by nothing at all.

## Patterns

A pattern is a [`path-to-regexp`](https://github.com/pillarjs/path-to-regexp) route. Wayfinder
compiles each one into a matcher and a builder, so the same string both recognises a request path
and produces an href.

```
/journal/:slug          articles keyed by slug, under a fixed prefix
/:section/:slug         articles keyed by slug, inside a section
/*path                  pages keyed by their full path
```

A pattern must contain at least one parameter. A pattern with none identifies no document, so it is
rejected on save.

Every parameter has to resolve to something the collection can be queried by. A parameter naming a
plain field queries that field. A parameter naming a relationship queries the related document's
identifier, so `:section` on a collection with a `section` relationship becomes `section.slug`. The
identifier is derived from the target collection's own pattern rather than assumed: the last
parameter of the pattern a collection is served at is, by definition, what identifies its
documents. A project keyed by `permalink` or `handle` therefore needs no configuration, and cannot
drift out of sync with its own routes. `DEFAULT_IDENTIFIER_FIELD` (`"slug"`) is the fallback when
nothing can be derived, and `fallbackIdentifierField` overrides it. It is set once, where mappings
are compiled, and rides every compiled mapping from there.

A polymorphic relationship whose targets derive different identifier fields is rejected at save
time. One query path cannot express two, and silently matching on whichever target came first would
be worse than refusing.

## The last parameter identifies the document

This is the one rule the whole package rests on. In `/:section/:slug`, `slug` is the identifier and
`section` is scope. Matching a path yields exactly that split:

```ts
// matching "/legal/imprint" against "/:section/:slug"
{
  identifier: { field: "slug", value: "imprint" },
  scope: { section: "legal" },
}
```

The identifier becomes the primary condition of the lookup. Every scope parameter becomes an
additional condition ANDed onto it. Ordering follows the pattern's own parameter list rather than
the params object, so the last parameter is reliably the identifying one no matter how the pattern
was written.

The same rule runs backwards. `router.href` reads one value per parameter off the document, in
pattern order, and compiles the pattern from them. A parameter pointing at a populated relationship
yields the related document's identifier, which is exactly what the lookup matches on, so build and
match agree by construction.

`router.path` uses the rule to accept values positionally. A sitemap can pass `["legal", "imprint"]`
without knowing what the parameters are called, so renaming one in the CMS needs no code change.
Values keyed by parameter name work too.

## Specificity and multi-candidate fallback

More than one pattern can match the same path. `/legal/imprint` fits `/:section/:slug` and a
wildcard equally well. Wayfinder returns every candidate rather than picking one, ordered
most-specific first:

1. more literal segments wins, so `/journal/:slug` beats `/:section/:slug` for `/journal/hello-world`
2. a fixed-arity pattern beats a catch-all
3. more total segments wins
4. the collection name breaks the last tie, alphabetically

The final tiebreak exists because the order is otherwise decided by whichever row an editor
happened to drag higher, and resolution has to stay deterministic.

`router.resolve` walks the ordered candidates and returns the first one that actually has a
document. Without the fallback a nested page path would be claimed by a more specific pattern and
404 even though the page exists.

## The wildcard storage contract

A wildcard parameter stands for a whole path, not a single segment, so its value carries a leading
slash. A wildcard-mapped collection stores `/about/team` in its identifier field, not `about/team`.

That is a storage contract, not an implementation detail. The value a match produces is normalised
to carry the leading slash, and the value handed back to the builder is stripped of it again, so
whatever a document holds in the field the pattern names has to be in the same shape. Author your
path field to store leading-slash values.

Three consequences follow:

- **The site root.** `path-to-regexp` requires at least one segment, so a wildcard pattern cannot
  match `/`. The collection whose pattern is a bare catch-all owns the root instead, and it is
  identified by a path of exactly `/`. Building that document's href returns `/`, still passed
  through `formatHref` so it does not miss the locale and preview prefixes every other path
  receives.
- **Relationships to a wildcard collection.** A wildcard target is deliberately excluded from
  identifier derivation. Its stored value carries a leading slash while a value arriving from a
  match is a bare segment, so a query built from it would never match, and would fail as an empty
  result rather than as an error. Such parameters fall back to `fallbackIdentifierField`.
- **Nothing normalises the shape for you.** A document whose path field holds `about/team` will not
  be found at `/about/team`.

## Diagnostics

Every routing call returns `null` (or, for `router.path`, the site root) on failure, so the happy
path stays a plain value. That leaves no way to tell "this collection has no mapping" from "this
relationship was never populated", which is exactly the distinction someone staring at a missing
link needs. The `onDiagnostic` callback carries it out of band:

```ts
const router = createRouter({
  mappings,
  locale: "en",
  onDiagnostic: (d) => console.warn("[routing]", d.reason, d.collection),
});

router.href("articles", document);
```

| Reason                  | Reported by                                    |
| ----------------------- | ---------------------------------------------- |
| `no-mapping`            | `router.href`, `router.path`, `router.resolve` |
| `no-locale-pattern`     | `router.href`, `router.path`                   |
| `missing-param`         | `router.href`                                  |
| `unpopulated-reference` | `router.link`                                  |
| `unknown-variant`       | `router.link`                                  |
| `no-document`           | `router.resolve`                               |

Diagnostics fire once per failed call. See
[`limitations.md`](./limitations.md#diagnostics-are-not-deduplicated).
