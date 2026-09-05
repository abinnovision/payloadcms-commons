# Layers

The package is three layers and three optional surfaces. Each layer works without the ones above
it, which is what makes the runtime usable in a sitemap script, a test, or a project with no admin
panel at all.

## L1: pattern

Entrypoints: `.` and `./internal`

Pure pattern arithmetic. It compiles a `PayloadCollectionMapping` into matchers and builders, ranks
candidates by specificity, and works out which field a parameter queries.

What an application declares its map and its links with is on `.`:

```
defineMappings            compile a code-defined map
defineLinks               declare an app's link vocabulary
deriveLinkLabel           a link's destination hint, shared by the editor feature and the admin component
```

The compilation and matching steps behind them are on `./internal`:

```
variantsOf                flatten either form of variant declaration into one list
resolveCollectionMapping  compile one mapping
resolversFor              pick a locale's resolvers, falling back to the unlocalized bucket
matchCollectionMappings   every candidate for a path, most specific first
resolveParamQueryPath     the query path a parameter filters on
isRootWildcard            whether a wildcard pattern was handed the site root
```

Depends on `path-to-regexp` and on `import type` from `payload`, which erases. No database, no
network, no React.

### `defineLinks` returns plain data

A declaration built by [`defineLinks`](./linking.md#declaring-link-types-with-definelinks) is an
object of variant definitions and nothing else. It builds no field and resolves no link itself.

Binding a `links.resolve(...)` method to it would be the obvious convenience, and is the reason it
does not have one. The declaration is a single module that both sides import: `payload.config.ts`
hands it to `linkField`, and the frontend hands it to `createRouter`. A method would make that
module depend on the runtime, and `linkField` already makes the config side depend on
`payload/shared`. Every consumer would then pull in both, so a frontend that only resolves links
would ship the config layer to call a method on a value it already holds.

Keeping it data leaves each side importing only the layer it needs. `linkField` comes from
`./config`, `createRouter` from `.`, and the declaration itself from `.` with no runtime attached.

## L2: runtime

Entrypoints: `.` and `./internal`

What an application calls is `createRouter`, plus one helper that stands on its own:

```
createRouter              binds the mappings, the locale and the href formatter into a router
resolveRelationshipSlug   a relationship parameter's raw value -> the identifier behind it
```

A `Router` carries six methods:

| Method        | Takes                                          | Gives                             |
| ------------- | ---------------------------------------------- | --------------------------------- |
| `href`        | a collection slug and a document               | the href it is served at, or null |
| `path`        | a collection slug and parameter values         | a path, never null                |
| `link`        | a link field value                             | `ResolvedLinkOf`, or null         |
| `linkNode`    | a rich-text link node's `fields`, as `unknown` | `ResolvedLinkOf`, or null         |
| `isAvailable` | a link field value                             | whether it would resolve          |
| `resolve`     | a request path and a `Payload` instance        | the document behind it, or null   |

`resolve` and `resolveRelationshipSlug` take a `Payload` instance because they query. The rest are
synchronous and touch nothing.

### Why the router binds rather than each call taking everything

The mappings, the locale and the href formatter reach every one of those methods, and threading
them by hand meant every call site could get one wrong. The formatter is the expensive one to
forget: it has to reach three functions to be correct, and the one easiest to overlook is
`link`, which builds hrefs internally, so omitting it there sends a visitor out of the locale or
out of preview on the first click. Binding once makes that impossible.

Only the values that vary per request are bound. The one that does not — which field a
relationship parameter falls back to — rides the compiled mappings instead, set once as
`fallbackIdentifierField` when the mappings are built.

The unbound functions the router closes over are exported from `./internal`, for a caller that
holds no request or wants a different set of arguments per call, and they are what the package's
own tests use. Nothing there carries a compatibility guarantee.

```
buildHref                 document -> href
buildPath                 parameter values -> path, with no document
resolvePathToDocument     path -> document, for a catch-all route
resolveLink               link field value -> ResolvedLinkOf
isAvailableLink           whether a link would resolve to something navigable
normaliseLinkNodeFields   either shape of rich-text link node -> a link field value
identityFormatHref        the default no-op formatter
```

### The runtime never reads the global

Every runtime function takes `mappings` as data. Not a Payload instance it reads from, not a
module-level singleton it populates at boot: an array of compiled mappings, passed in.

That is the seam the whole package hangs on. It means the CMS-authored global is one way to produce
mappings and [`defineMappings`](./code-defined-mappings.md) is the other, with neither privileged.
It means a sitemap, a feed, a migration and a unit test can all build hrefs without standing up a
global. It means the read is under the caller's control, so it can be cached, request-scoped, or
skipped entirely. And it means there is no hidden global state to get stale.

The cost is that reading the global is your call to make. `loadMappings` is the one function that
does it, and where you call it is an integration decision, covered in
[`integration.md`](./integration.md#2-load-the-mapping).

## L3: config

Entrypoint: `./config`

Everything that goes into `payload.config.ts`.

```
wayfinderPlugin              registers the global and the admin translations
createMappingGlobal          the global on its own, without the plugin
DEFAULT_MAPPING_GLOBAL_SLUG  "collections-mapping"
loadMappings                 read the global and compile it
linkField                    the routing-aware link field
createCollectionStringField  a text field validated against the registered collections
wayfinderTranslations        the admin messages the plugin registers
hasDuplicates                the duplicate check the global's validators use
```

This entrypoint never imports React. `payload.config.ts` is loaded by the CLI, by migrations and by
`payload generate:types`, all of which would break on a React import.

`wayfinderPlugin` decides the global's slug, and `loadMappings` has to be told the same one: a
mismatch means writing to one global and reading from another. Whether patterns are per-locale is
not decided twice at all. The plugin derives it from the config's `localization` block and
`loadMappings` derives it from the running instance, which is the same authority, so the write
side and the read side cannot drift.

The plugin also runs one startup check: a collection listed in `checkDefaultPopulateOn` that has no
`defaultPopulate` gets a console warning, because references resolve off the populated document.
`resolvesReferencesExternally: true` suppresses it for a project that resolves references its own
way, and `quiet: true` silences the checks entirely.
[`integration.md`](./integration.md#5-defaultpopulate-on-linkable-collections) explains what the
warning is about.

## The three optional surfaces

Each pulls in an optional peer, and each is a separate entrypoint so that a project not using it
never resolves that peer.

| Entrypoint  | Peer                               | Contents                                                      |
| ----------- | ---------------------------------- | ------------------------------------------------------------- |
| `./lexical` | `@payloadcms/richtext-lexical`     | `wayfinderLinkFeature`, `linkLabelFeature`, `resolveLinkNode` |
| `./admin`   | `@payloadcms/ui`, `react`          | `LinkLabelFeatureClient`                                      |
| `./montage` | `@abinnovision/payloadcms-montage` | `initWayfinder`, `wayfinderFrom`, `wayfinderExtension`        |

`./lexical` replaces Lexical's own link fields with the wayfinder link field, so a link written in
rich text routes through the mapping exactly like a link authored in a block. `./admin` holds the
one client component `linkLabelFeature` mounts through the import map. `./montage` parks a bound
router on the montage render context, so a page reads the mapping once and every block on it
resolves through the same locale and the same href formatter rather than each being handed the
pieces. See [`linking.md`](./linking.md) and [`recipes.md`](./recipes.md#request-scoped-mappings).

Resolving a rich-text link needs none of this. `router.linkNode` takes the node's `fields` as
`unknown` and lives on `.`, so a frontend that renders rich text produced elsewhere never resolves
`@payloadcms/richtext-lexical`. `./lexical` is for the editor half — the features that put the
wayfinder link field into the editor — plus `resolveLinkNode` for a caller that wants the same
resolution unbound.

## What works without what

| You want                                   | You need                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| hrefs in a script or a test                | `.` and `defineMappings`. No Payload instance.                                                                  |
| hrefs from CMS-authored routing            | `.` plus `loadMappings` from `./config`                                                                         |
| path resolution for a route                | the above plus a `Payload` instance                                                                             |
| an editor-facing link field                | `linkField` from `./config`. The mapping global is not required to render the field, only to resolve its value. |
| hrefs for rich-text link nodes             | `.` and `router.linkNode`. No rich-text peer.                                                                   |
| the wayfinder link field inside the editor | `./lexical`, plus `./admin` in the import map                                                                   |
| a router on a montage context              | `./montage`                                                                                                     |
| the unbound functions themselves           | `./internal`, which carries no compatibility guarantee                                                          |

Nothing in `.` requires the global. Nothing in `./config` requires the runtime. The mapping global
requires neither: `createMappingGlobal` can be added to a config by hand without the plugin, though
it then falls back to English admin messages
([`limitations.md`](./limitations.md#placing-the-global-by-hand-loses-two-things-the-plugin-does-for-you)).
