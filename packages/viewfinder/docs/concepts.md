# Concepts

Viewfinder is an addressing and transport layer, and that is all it is. It answers one question in
each direction: which block in the admin form does this DOM node belong to, and which DOM node does
this form row belong to. What you do with that answer is yours.

## What viewfinder owns, and what you own

| Viewfinder owns                             | You own                                       |
| ------------------------------------------- | --------------------------------------------- |
| stable identifiers on the rendered DOM      | which blocks get marked, and where            |
| resolving an id to a path in the admin form | your live-preview route and draft handling    |
| resolving a form path back to an id         | your preview flag, and how it reaches a block |
| a validated two-way `postMessage` channel   | the content model, the fields, the components |
| the highlight overlay in the preview        | anything that mutates content                 |

The last row is the scope boundary. Viewfinder never writes to a document, never patches form
state, and has no editing UI. Inline editing is a plausible consumer of this layer, not part of it:
knowing which node maps to which field is the hard, reusable half, and it is worth having on its
own for navigation alone.

## Ids, not a content source map

The usual way to connect a rendered page back to a CMS is a content source map: the API annotates
every value it returns with the path it came from, and the frontend carries those annotations into
the markup. That means an API change, a virtual field or an encoding scheme, and an annotation on
every element that renders a value.

Viewfinder does none of that, because Payload already provides the identifier it needs. Every block
row in a `blocks` field carries an `id`. The frontend emits only that:

```html
<div data-vf-id="6716b1f0c3a5..." data-vf-type="hero-module">…</div>
```

The admin resolves the id to a form path by scanning its own form state. Payload keys that state
flat, by field path, so a block three levels deep appears as discrete entries such as
`layout.0.modules.2.heading` rather than as a nested document. Finding the row whose `*.id` value
matches is a scan over keys, not a tree walk, and it needs no knowledge of the collection's schema.

The consequences are worth stating plainly. No API change, no virtual field, no per-element
annotation, and nothing in the rendered output that reveals your content structure beyond an opaque
row id. The cost is that addressing is block-level by default: an id identifies a row, not the
individual values inside it.

## Block-relative field names

Field addressing is opt-in, through `markField`, and its argument is relative to the enclosing
block:

```tsx
<section {...markBlock(block.id, block.blockType)}>
  <h2 {...markField("heading")}>{block.heading}</h2>
</section>
```

Relative, not absolute, for two reasons. A block component does not know where in the document it
was mounted, so it could not write an absolute path even if it wanted to. And a relative name
survives the block moving: reorder the layout and `layout.0` becomes `layout.3`, but `heading` is
still `heading`. The admin joins the two at resolution time, once it has found the block's own
path.

A field marker only counts when its own nearest marked block is the block it sits in. Without that
rule, a block nested inside a marked field of its parent would report the parent's field name as
its own.

## The two directions

Preview to admin: hovering walks the pointer's target up to the nearest `data-vf-id`, outlines that
block and names it. A click anywhere inside the block posts its address to the parent window; the
admin resolves it to a form path, expands every collapsed ancestor around it, scrolls to it and
flashes it.

The whole block is the target rather than a control drawn on top of it, because a control small
enough not to obscure the block is also small enough to be hard to hit, and it has to be aimed at
after the block has already been found. The cost is that a plain click on a link inside a marked
block selects instead of navigating while the page is framed. Clicks carrying a modifier, and
clicks outside every marked block, are never touched.

Admin to preview: hovering anywhere in a block row, header or fields, outlines that block in the
preview and nothing else, so an editor can sweep the form and see what each row is without the
preview moving. One listener on the document walks up from the pointer's target to the innermost
row containing it, which mirrors how the preview resolves a block and gives nesting the same
answer: a hero inside a section wrapper is reached before the wrapper is. The button in the row
header is what scrolls, posting that row's address into the iframe; the preview finds the element
with that id, measures it, scrolls to it and draws the overlay.

Hover and click are split that way on purpose. An earlier version scrolled the preview on any click
or focus change in the form, which moved the page while an editor was only placing a caret.

The button is portalled rather than registered as the block's `Label` component. That slot replaces
the whole header fragment, including the block-name input, and only reaches blocks that live in
`config.blocks`, so inline blocks passed through `blockReferences` would silently get nothing.

Both windows treat the other as untrusted. Every message carries a source tag and a protocol
version, and is validated structurally on arrival rather than cast. The frontend requires an
explicit `adminOrigin` and checks both `event.origin` and `event.source`; the admin answers only
the window Payload itself put in the preview frame. A version mismatch is dropped silently, so a
stale frontend deployment cannot drive a newer admin.

## Entrypoints

```
"."        attributes, protocol, path resolution
"./client" ViewfinderBridge, Marked, markBlock, markField
"./config" viewfinderPlugin, loaded from payload.config.ts
"./admin"  ViewfinderFormBridge, mounted by the plugin through the import map
```

`.` is the shared half. Both bundles need the same attribute names, the same message envelope and
the same path arithmetic, and if the two halves disagreed on any of it the addressing would break
silently. It is pure string and object work, so it imports nothing at all: no React, no Payload, no
Next. A test asserts that, since "shared" is only worth anything if it stays cheap to share.

`./config` is loaded by the CLI, by migrations and by `payload generate:types`. It must never
import React. It contains one function, `viewfinderPlugin`, and needs only `import type` from
`payload`, which erases.

`./client` and `./admin` are separate because they run in different bundles with different
dependencies. `./admin` reads form state through `@payloadcms/ui`, an optional peer that only a
Payload admin has; `./client` runs in a consumer's frontend, which usually does not. Splitting them
keeps `@payloadcms/ui` out of the frontend bundle and `payload` out of both.

## Where it touches Payload internals

Two places, each isolated to one file so that a Payload upgrade touches one place:

`src/resolve-path.ts` assumes form state is flat-keyed by field path, with a row's `id` at
`<path>.id` and its type at `<path>.blockType`.

`src/admin/element-id.ts` assumes the admin's DOM conventions: a field wrapper is
`id="field-<path with dots as __>"` and a block row is
`id="<parent path with dots as ->-row-<index>"`.

Neither is a public Payload contract. Both are listed in
[`limitations.md`](./limitations.md#known-gaps) as assumptions rather than facts.
