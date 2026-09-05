# Layers

The package is three layers and three optional surfaces. Each layer works without the ones above
it, which is what makes the runtime usable in a sitemap script, a test, or a project with no admin
panel at all.

## L1: pattern

Entrypoint: `.`

Pure pattern arithmetic. It compiles a `PayloadCollectionMapping` into matchers and builders, ranks
candidates by specificity, and works out which field a parameter queries.

```
defineMappings            compile a code-defined map
defineLinks               declare an app's link vocabulary
variantsOf                flatten either form of variant declaration into one list
resolveCollectionMapping  compile one mapping
resolversFor              pick a locale's resolvers, falling back to the unlocalized bucket
matchCollectionMappings   every candidate for a path, most specific first
resolveParamQueryPath     the query path a parameter filters on
isRootWildcard            whether a wildcard pattern was handed the site root
deriveLinkLabel           a link's destination hint, shared by the editor feature and the admin component
```

Depends on `path-to-regexp` and on `import type` from `payload`, which erases. No database, no
network, no React.

### `defineLinks` returns plain data

A declaration built by [`defineLinks`](./linking.md#declaring-link-types-with-definelinks) is an
object of variant definitions and nothing else. It builds no field and resolves no link itself.

Binding a `links.resolve(...)` method to it would be the obvious convenience, and is the reason it
does not have one. The declaration is a single module that both sides import: `payload.config.ts`
hands it to `linkField`, and the frontend hands it to `resolveLink`. A method would make that
module depend on the runtime, and `linkField` already makes the config side depend on
`payload/shared`. Every consumer would then pull in both, so a frontend that only resolves links
would ship the config layer to call a method on a value it already holds.

Keeping it data leaves each side importing only the layer it needs. `linkField` comes from
`./config`, `resolveLink` from `.`, and the declaration itself from `.` with no runtime attached.

## L2: runtime

Entrypoint: `.`

The functions an application calls.

```
buildHref                 document -> href
buildPath                 parameter values -> path, with no document
resolvePathToDocument     path -> document, for a catch-all route
resolveLink               link field value -> { href, target?, rel? }
isAvailableLink           whether a link would resolve to something navigable
resolveRelationshipSlug   a relationship parameter's raw value -> the identifier behind it
identityFormatHref        the default no-op formatter
```

`resolvePathToDocument` and `resolveRelationshipSlug` take a `Payload` instance because they query.
The rest are synchronous and touch nothing.

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

`wayfinderPlugin` is the single place the global's slug and its `localized` flag are decided, so
the write side and the read side cannot drift. `loadMappings` has to be told the same two things,
and a mismatch means writing to one global and reading from another.

The plugin also runs one startup check: a collection listed in `linkableCollections` that has no
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
| `./montage` | `@abinnovision/payloadcms-montage` | `initWayfinder`, `getMappings`, `wayfinderExtension`          |

`./lexical` replaces Lexical's own link fields with the wayfinder link field, so a link written in
rich text routes through the mapping exactly like a link authored in a block. `./admin` holds the
one client component `linkLabelFeature` mounts through the import map. `./montage` parks the
compiled mappings on the montage render context so a page reads them once rather than once per
block. See [`linking.md`](./linking.md) and
[`recipes.md`](./recipes.md#request-scoped-mappings).

## What works without what

| You want                        | You need                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| hrefs in a script or a test     | `.` and `defineMappings`. No Payload instance.                                                                  |
| hrefs from CMS-authored routing | `.` plus `loadMappings` from `./config`                                                                         |
| path resolution for a route     | the above plus a `Payload` instance                                                                             |
| an editor-facing link field     | `linkField` from `./config`. The mapping global is not required to render the field, only to resolve its value. |
| links inside rich text          | `./lexical`, plus `./admin` in the import map                                                                   |
| mappings on a montage context   | `./montage`                                                                                                     |

Nothing in `.` requires the global. Nothing in `./config` requires the runtime. The mapping global
requires neither: `createMappingGlobal` can be added to a config by hand without the plugin, though
it then falls back to English admin messages
([`limitations.md`](./limitations.md#translations-only-come-with-the-plugin)).
