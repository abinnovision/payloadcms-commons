# Concepts

Montage is a typed block registry and RSC renderer. That is the whole scope. It does not model
pages, sections, templates, or reusable blocks. Those are decisions you make with Payload's own
collections, globals, and fields.

## What montage owns, and what you own

| Montage owns                                   | You own, using plain Payload                         |
| ---------------------------------------------- | ---------------------------------------------------- |
| the slug to component registry                 | your collections, globals, and fields                |
| dispatching a block to its component           | page structure: a `blocks` field is a `blocks` field |
| the render context passed to every block       | reusable-block patterns, however you model them      |
| resolving block data before render             | your section, layout, and template components        |
| deciding whether a block renders (`canRender`) | which slugs a given field offers                     |
| rendering blocks embedded in Lexical           | preview, caching, routing, i18n                      |

This is a deliberate cut, not an oversight. An earlier draft of this package modeled a section
wrapper, a global-block collection, global references, layout regions, and document templates as
first-class concepts. All of it turned out to be buildable in a few lines on top of the engine
below, using nothing but `canRender`, the renderer, and the render context. See
[`recipes.md`](./recipes.md) for the rebuild.

Montage takes no dependency on Next. `Link`, `Image`, `locale`, `draft`, and anything else
framework-shaped reach your blocks through your own context fields, not through montage.

## Two entrypoints

```
"."         the renderer, registry, context, resolver
"./config"  montagePlugin, loaded from payload.config.ts
"./lexical" converters for blocks embedded in richtext
```

`payload.config.ts` is loaded by the CLI, migrations, and `payload generate:types`. It must never
import React. `./config` contains one function, `montagePlugin`, and imports nothing but
`payload`'s own types.

`./lexical` is separate from `.` because its return type, `JSXConverters`, comes from
`@payloadcms/richtext-lexical`, an optional peer. Keeping it off the core entrypoint means a
consumer who never touches richtext never resolves that type.

## Slug-first typing

Payload exports `BlockSlug` and `TypedBlock`, built from `config.blocks` once you run
`payload generate:types`. Montage's `defineBlockComponent` uses them directly:

```ts
defineBlockComponent("hero-module", {
  component: ({ block }) => block.title, // block is TypedBlock["hero-module"], inferred
});
```

A typo in the slug is a compile error. So is registering a component under the wrong key in
`defineBlockRegistry`, because the registry's mapped type ties each component's own slug to its
key:

```ts
defineBlockRegistry({
  "hero-module": NumbersGridModule, // compile error: slug mismatch
});
```

Without generated types, `BlockSlug` degrades to `string` rather than `never`, which would make
every guarantee above silently disappear. `defineBlockRegistry` guards against this: without
generated types, it fails to compile with a message telling you to run `generate:types`.

## Inline blocks

Blocks declared inline in a field, rather than in `config.blocks`, are common: a section wrapper,
a global reference block, a synthetic document-shell root. They get no generated interface, so
`defineInlineBlockComponent` takes the type explicitly:

```ts
defineInlineBlockComponent<SectionWrapperBlock>()("section-wrapper", {
	component: ({ block, ctx, renderer }) => /* ... */,
});
```

It is curried so the block type and the data type can both be inferred correctly; see
[`rendering.md`](./rendering.md) for why.

## One trap to know about

Payload keys generated block interfaces by name. If you instantiate the same block config more
than once (for example, one section-wrapper block per collection, with a different set of
allowed nested blocks each time) under a shared `interfaceName`, the generated union silently
keeps only the last definition's members: the schema for each name goes into a `Map`, so a
repeated name overwrites. Which instance wins depends on the order Payload traverses your config,
so it is not stable across edits.

If you do this, give each instance its own `interfaceName`. Leaving `interfaceName` off entirely
also avoids the collision, since each usage is then inlined separately, at the cost of a named
type to import. Montage cannot prevent this; your build will simply produce the wrong type.
