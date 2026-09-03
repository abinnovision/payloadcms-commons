# Recipes

These are not montage features. Each is a small piece of your own code, built entirely on the
public API in [`rendering.md`](./rendering.md). They are here because the package deliberately
does not ship them (see [`limitations.md`](./limitations.md)), and to show that the boundary in
[`concepts.md`](./concepts.md) is a usable one, not just a small one. Every example below is a
real, tested fixture in this package's own test suite.

## Section wrapper

A block that renders a group of other blocks, collapsing to nothing if none of them can render:

```tsx
export const SectionWrapper = defineInlineBlockComponent<SectionWrapperBlock>()(
  "section-wrapper",
  {
    component: ({ block, ctx, renderer }) => {
      const visible = block.modules.filter((m) =>
        renderer.canRender({ block: m, ctx }),
      );
      if (visible.length === 0) return null;

      return (
        <section>
          {visible.map((m) => (
            <renderer.Block key={m.id} block={m} ctx={ctx} />
          ))}
        </section>
      );
    },
  },
);
```

`canRender` is the only engine capability this needs. Filtering with it before rendering, rather
than rendering and checking afterward, is what makes the collapse possible: React cannot un-render
a parent once a child has rendered nothing.

## Global reference

A block that renders another block, reached through a relationship:

```tsx
export const GlobalReference =
  defineInlineBlockComponent<GlobalReferenceBlock>()("global-reference", {
    component: ({ block, ctx, renderer }) => (
      <renderer.Block block={block.reference} ctx={ctx} />
    ),
  });
```

Nothing about montage needs to know a relationship was involved. If you resolve data for
`block.reference` too, remember it is a different object each time it is populated, so identity
keying applies to it independently.

## Page layout

A plain component, not a montage block, iterating fixed regions and passing along a
context extension so the first section can render differently (no divider above it, for
example):

```tsx
const isFirstSection = createContextExtension<boolean>("is-first-section");

export const PageLayout = ({ data, ctx, renderer }) => (
  <>
    {data.header?.[0] && <renderer.Block block={data.header[0]} ctx={ctx} />}
    {data.sections.map((section, i) => {
      const childCtx = createChildContext(ctx);
      isFirstSection.set(childCtx, i === 0);
      return <renderer.Block key={section.id} block={section} ctx={childCtx} />;
    })}
    {data.footer?.[0] && <renderer.Block block={data.footer[0]} ctx={ctx} />}
  </>
);
```

`createChildContext` is a shallow clone, so writing to the results store through the child is
still visible on the parent. Only top-level fields you replace on the child are isolated. This is
what lets `resolveBlockData` be called once on the root context and still work correctly from
every child.

## Cross-cutting visibility

A rule that applies to every block, rather than being repeated on each one, belongs on the
registry:

```ts
export const blocks = defineBlockRegistry(entries, {
  canRender: ({ block, ctx }) =>
    ctx.isPreview || isVisibleInLocale(block, ctx.locale),
});
```

This runs before the slug lookup, so a block hidden by this rule stays silent even if its
component has not been built yet, rather than triggering the unregistered-block error.

## Document template

A collection with its own model (projects, news, jobs, ...) can get one CMS-editable template
that renders every document in it, instead of a hand-authored page per document. The template is
just an inline block whose "block" is the whole document:

```tsx
type PagesDocumentTemplateBlock = {
  blockType: "pages-document-template";
} & Page;

export const PagesDocumentTemplate =
  defineInlineBlockComponent<PagesDocumentTemplateBlock>()(
    "pages-document-template",
    {
      resolve: ({ block }) => ({ title: block.title }), // whatever generateMetadata needs
      component: ({ block, ctx, renderer }) => (
        <PageLayout data={block.layout} ctx={ctx} renderer={renderer} />
      ),
    },
  );
```

In the route:

```tsx
const root = { blockType: "pages-document-template", ...page };
const ctx = createBlockContext<AppContext>({ locale, isPreview /* ... */ });

await renderer.resolveBlockData({ root, ctx });

return <renderer.Block block={root} ctx={ctx} />;
```

The synthetic `blockType` is a convention you choose, not something montage requires. Document
the ordering rule: `root` is bound to a single reference, and the same reference is passed to
both `resolveBlockData` and the render call, never rebuilt in between.

For `generateMetadata`, resolve only the root and read its data directly:

```ts
await renderer.resolveBlockData({ root, ctx, scope: "root" });
const meta = renderer.getBlockData(ctx, root);
```

Share `root` and `ctx` between `generateMetadata` and the page render (via `React.cache()`, for
example), so the root's resolver runs once per request rather than twice.
