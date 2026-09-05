# Recipes

Each recipe below is a small piece of your own code, written against montage's public API and
plain Payload. The package deliberately does not ship any of them (see
[`limitations.md`](./limitations.md)); together they show that the boundary drawn in
[`concepts.md`](./concepts.md) is a workable one. Every example is a real, tested
fixture in this package's own test suite, except the last one, which is running code from
`apps/example`.

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

`canRender` is the only engine capability this needs. The collapse works because the filtering
happens before rendering: React cannot un-render a parent once a child has rendered nothing.

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

A plain component rather than a montage block. It iterates fixed regions and passes along a
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

## Checking the config against the registry

Montage registers blocks in `config.blocks` and dispatches them from a separate registry. Nothing
cross-checks the two at runtime: linking them would mean importing the registry, and the React
components it holds, into the graph `payload.config.ts` loads. `defineBlockRegistry`'s `require`
narrows this, but you maintain that list by hand.

You can derive it instead. Keep the literal slug on each block config with `as const satisfies
Block`. A `: Block` annotation widens `slug` to `string`, and the derivation stops working:

```ts
// blocks.ts, config side. No React here.
import type { Block } from "payload";

export const heroBlock = {
  slug: "hero-module",
  fields: [],
} as const satisfies Block;
export const factsBlock = {
  slug: "location-facts-module",
  fields: [],
} as const satisfies Block;

export const montageBlocks = [heroBlock, factsBlock];
export type RegisteredSlug = (typeof montageBlocks)[number]["slug"];
```

Then compare that union against the registry's keys:

```ts
// registry.ts, render side.
import type { RegisteredSlug } from "./blocks.js";

/** Fails to compile unless `T` is `never`. */
type Assert<T extends never> = T;

const entries = {
  "hero-module": HeroModule,
  "location-facts-module": FactsModule,
};

type NoMissingComponent = Assert<Exclude<RegisteredSlug, keyof typeof entries>>;
type NoOrphanComponent = Assert<Exclude<keyof typeof entries, RegisteredSlug>>;

export const blocks = defineBlockRegistry(entries);
```

Both directions are checked. A block registered in the config with no component fails with
`Type '"location-facts-module"' does not satisfy the constraint 'never'`, naming the slug that
drifted. So does a component whose slug is in no block config.

This is stronger than `require`, which can only check the slugs you remember to list. It still
cannot see blocks contributed by other plugins, which is why `require` stays.

The assertion can live on either side. To keep it in the config file instead, import the component
slug union with `import type`. Type-only imports are erased, so no component reaches the graph
`payload.config.ts` loads.

## Addressable blocks for live preview

Making every rendered block point back at its own row in the admin form is one `wrapBlock` away.
This is the example app's real registry:

```tsx
import { Marked } from "@abinnovision/payloadcms-viewfinder/client";

import { HeroModule } from "./HeroModule";
import { RecentPostsModule } from "./RecentPostsModule";
import { SectionWrapper } from "./SectionWrapper";
import { defineBlockRegistry } from "../montage";

import type { ReactNode } from "react";

export const blocks = defineBlockRegistry(
  {
    "hero-module": HeroModule,
    "recent-posts-module": RecentPostsModule,
    "section-wrapper": SectionWrapper,
  },
  {
    require: ["hero-module", "recent-posts-module"],
    wrapBlock: ({ block, ctx, children }) => (
      <Marked
        blockType={block.blockType}
        enabled={ctx.isPreview}
        id={(block as { id?: string | null }).id ?? ""}
      >
        {children as ReactNode}
      </Marked>
    ),
  },
);
```

Because `wrapBlock` sits at montage's one dispatch point, this alone makes the whole tree
addressable: nested modules, inline blocks and richtext-embedded blocks included. Because it runs
after gating, a collapsed block leaves no marker behind. `ctx.isPreview` is the app's own context
field, not something montage knows about; outside preview `Marked` renders its children untouched.

The `id` cast is needed because `wrapBlock` sees a block as `{ blockType?: string }`. The value is
Payload's row id, which every saved block row carries.

[`@abinnovision/payloadcms-viewfinder`](../../viewfinder/README.md) is a separate, optional
package. Montage does not depend on it, it does not depend on montage, and `wrapBlock` is a generic
hook that happens to suit it. It does require server-side live preview, for the identity-keying
reason described under [Resolving data](./rendering.md#resolving-data): a client-side live preview
hands the page a freshly deserialised document, and no resolved data survives that.
