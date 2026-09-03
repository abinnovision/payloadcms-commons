# Rendering

## Defining a block component

```ts
export const HeroModule = defineBlockComponent("hero-module", {
	resolve: ({ block, ctx }) => fetchSomething(block, ctx), // optional
	expands: false, // optional, only meaningful with resolve
	canRender: ({ block, ctx, data }) => Boolean(data), // optional
	component: ({ block, ctx, data, renderer }) => <div>{block.title}</div>,
});
```

`resolve` is declared before `component` in the options object deliberately: it is what lets `D`,
the resolved data type, infer correctly into both `canRender` and `component`.

## The render context

`createBlockContext` takes your own base shape and returns it unchanged; montage adds no fields.
It reserves the `montage:` key prefix for its own use (the results store, and any context
extension you create) and reads nothing outside it.

```ts
const ctx = createBlockContext<AppContext>({ locale: "de", draft: false });
```

Two rules the plumbing depends on:

- **A context is per request and mutable.** `resolveBlockData` writes to it. Never reuse one
  across requests.
- **Resolve before cloning.** `createChildContext` is a shallow clone. The results store lives
  behind a shared reference, so cloning before you resolve gives the child no results.

The context is **not serializable** once montage has written to it, because the results store is
a `Map` keyed on object identity. Pass individual fields to client components, not the whole
context.

## `renderer` is an argument, not an import

Every block component receives `renderer` in its arguments. Use it, rather than importing a
renderer from somewhere else:

```ts
component: ({ block, ctx, renderer }) => {
	const visible = block.modules.filter((m) => renderer.canRender({ block: m, ctx }));
	return visible.map((m) => <renderer.Block key={m.id} block={m} ctx={ctx} />);
},
```

This is what makes montage reentrant. Two renderers built from two registries, in the same
process, do not share state. Importing a renderer from a shared module would recreate exactly the
module-level-singleton problem montage exists to avoid, and would create an import cycle between
the registry and its own components.

## Async components versus `resolve`

A block component may be a plain `async` function that fetches inline. That is the default, and
it needs no other machinery.

`resolve` exists for one reason: **collapse**. If a parent needs to know, before rendering,
whether a child will render anything (so it can render nothing itself rather than an empty
wrapper), the parent has to inspect data the child hasn't fetched yet. React gives no way to
inspect what a child will render before rendering it, and no way to un-render a parent
afterwards. `resolve` runs ahead of render specifically so `canRender` can see the result.

So: write a plain async component by default. Reach for `resolve` when a block needs to
participate in a parent's collapse decision, or when it sits deep enough in the tree that
fetching ahead of render (in parallel with its siblings) matters more than fetching inline.

The cost is explicit: a block that fetches inline cannot participate in collapse, because nothing
can know in advance that it will return nothing.

## Resolving data

```ts
await renderer.resolveBlockData({ root, ctx });
```

Traversal visits any plain object carrying a string `blockType`, including inside arrays, plain
objects, richtext subtrees, and populated relationship values. This matches how a document
usually arrives from Payload: relationships are already populated, not lazily fetched.

**Results are keyed by node identity.** A resolved node's data lives behind the exact object
reference that was traversed, not a computed key. This is what removes any requirement that a
node have an `id` (a synthetic root works, for example), but it introduces one rule:

> Do not spread or clone a block between resolving and rendering. Montage matches results by
> object identity, so a re-created object gets no data.

In development, montage warns when it renders or looks up a node whose `blockType` has a
registered resolver but no entry in the results store, which is exactly this mistake.

### Bounding fan-out with `expands`

A resolver whose result itself contains blocks that need resolving should declare `expands:
true`. Default is `false`. Without it, a resolver returning, say, ten full related documents
would leave those documents' own nested blocks unresolved, which is almost always what you want:
resolving a slider's items should not also run every module inside every related document.

```ts
resolve: async ({ block }) => fetchRelatedProjects(block.limit),
expands: false, // the default; the projects' own layouts are not traversed
```

Expansion iterates: if an `expands` resolver's result itself contains another `expands` node,
that one is followed too, up to `maxPasses` (default 3). Exceeding it throws in development and
warns and stops in production, since with `expands` the pass count depends on content, not code.

### `scope`: partial resolution

```ts
await renderer.resolveBlockData({ root, ctx, scope: "root" }); // default is "tree"
```

`scope: "root"` resolves only the `root` node itself. It does not traverse, and it ignores
`expands`. This is what a `generateMetadata`-style function should use: it typically needs a
title or description that lives on the document's own resolver, and nothing else.

Calls accumulate on one context. A `scope: "root"` call followed by a `scope: "tree"` call does
not re-run the root's resolver, but it still expands the root's stored result if the root
declared `expands`, so nothing is lost between the two calls.

```ts
// generateMetadata
await renderer.resolveBlockData({ root, ctx, scope: "root" });
const meta = renderer.getBlockData(ctx, root);

// the page render, sharing the same ctx and root via React.cache()
await renderer.resolveBlockData({ root, ctx });
```

Cache the **root object and the context together**. A separate context means a separate results
store, and the root resolver runs twice.

### Errors

A rejected resolver leaves that node's data `undefined` and never fails the render or the pass,
in any environment; a single failing query should not blank a page. Development additionally logs
the error.

## Unregistered blocks

`renderer.Block` (and its narrower sibling, `renderer.renderBlockTree`, used in tests) throws on
direct dispatch of an unregistered slug when `NODE_ENV !== "production"`, and renders nothing
otherwise. `renderer.canRender` never throws; it returns `false` and logs a warning in
development, so the common `filter(canRender)` pattern stays usable rather than becoming a trap.
