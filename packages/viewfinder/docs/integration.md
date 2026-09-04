# Integration

Five steps: register the plugin, generate the import map, configure live preview, mount the
frontend bridge, mark the blocks. Only the last step differs depending on whether you use
[`@abinnovision/payloadcms-montage`](../../montage).

## 1. Register the plugin

```ts
// payload.config.ts
import { viewfinderPlugin } from "@abinnovision/payloadcms-viewfinder/config";
import { buildConfig } from "payload";

export default buildConfig({
  // ...
  plugins: [viewfinderPlugin({ collections: ["pages"] })],
});
```

`collections` and `globals` both default to every entity in the config. Naming them narrows the
mount to the ones that actually have a preview.

The plugin appends one component to `beforeDocumentControls`: on collections that slot lives under
`admin.components.edit`, on globals under `admin.components.elements`. That is the mount point
because it renders inside the document `<Form>`, which is what gives the bridge access to form
state. The global `admin.components.providers` slot wraps the dashboard from outside every form, so
a provider mounted there could never resolve a field path.

The mounted component renders nothing and stays inert until a framed page announces itself, so
enabling it for a collection with no live preview costs nothing beyond the component.

## 2. Generate the import map

```sh
payload generate:importmap
```

Payload resolves admin components by import path, and the plugin refers to
`@abinnovision/payloadcms-viewfinder/admin#ViewfinderFormBridge`. Without a regenerated import map
the admin cannot find it. Re-run this whenever you add or remove the plugin, as for any plugin that
contributes admin components.

## 3. Configure live preview

```ts
// collections/pages.ts
export const pages: CollectionConfig = {
  slug: "pages",
  admin: {
    livePreview: {
      url: ({ data }) =>
        `/preview?path=${encodeURIComponent(`/${String(data["slug"] ?? "")}`)}`,
    },
  },
  versions: { drafts: true },
  // ...
};
```

Setting `admin.livePreview.url` gives you Payload's server-side live preview: the iframe loads the
real route rather than a client-rendered copy. Pair it with `RefreshRouteOnSave` from
`@payloadcms/live-preview-react`, mounted in the frontend. It calls `router.refresh()` when the
admin posts an update, so the page re-renders on the server with fresh data.

If drafts are on, the preview URL usually points at a route of your own that turns draft mode on
before handing off to the real page. That route is your app's concern, not viewfinder's, but it
should be gated on the Payload session the admin already holds, so an unauthenticated visitor
cannot enable draft mode for themselves. `apps/montage-example/src/app/(app)/preview/route.ts` in
this repository is a working example.

Viewfinder itself only needs the page to be in an iframe. It does not read the preview URL, the
draft flag, or anything else about how the route was reached.

### Why server-side, not client-side

Payload also offers client-side live preview, where `useLivePreview` receives the changed document
over `postMessage` and re-renders the page in the browser without a server round trip.

That mode does not work with montage. Montage keys resolver results by object identity
(`packages/montage/src/resolver/execute.ts`): a resolved node's data lives behind the exact object
reference that was traversed. Client-side live preview hands the page a freshly deserialised
document, every node of which is a new object, so nothing resolved survives the round trip. Montage
documents this as a rule already: do not clone a block between resolving and rendering.

Server-side live preview re-runs the render, including `resolveBlockData`, on the server, so the
identity keying holds. Without montage the constraint does not apply and client-side live preview
is fine as far as viewfinder is concerned, as long as the marked ids stay on the elements.

## 4. Mount the frontend bridge

```tsx
// app/layout.tsx
import { ViewfinderBridge } from "@abinnovision/payloadcms-viewfinder/client";

const serverURL = process.env["PAYLOAD_URL"] ?? "http://localhost:3000";

const Layout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en">
    <body>
      {children}
      <ViewfinderBridge adminOrigin={new URL(serverURL).origin} />
    </body>
  </html>
);
```

Mount it once, near the root. It attaches no listeners and draws nothing when
`window.parent === window`, so the same tree serves real visitors; there is no second layout to
keep in step.

| Prop                  | Required | Purpose                                                                                                                                                                  |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `adminOrigin`         | yes      | Origin of the Payload admin. Required rather than defaulting to `"*"`: this window posts the ids it renders.                                                             |
| `interceptNavigation` | no       | Suppress link navigation for clicks inside a marked block, so selecting a block does not navigate away. Defaults to `true`; hold a modifier key to follow a link anyway. |

## 5a. Mark the blocks, without montage

Wrap each block where you render it:

```tsx
import { Marked } from "@abinnovision/payloadcms-viewfinder/client";

{
  page.layout.map((block) => (
    <Marked
      key={block.id}
      id={block.id ?? ""}
      blockType={block.blockType}
      enabled={isPreview}
    >
      <BlockComponent block={block} />
    </Marked>
  ));
}
```

`enabled` is your own preview flag. When it is false, `Marked` returns its children untouched, with
no wrapper and no attributes. An empty `id` is treated the same way, so an unsaved row cannot emit
an address that resolves to nothing.

A block that already renders a stable root element can spread `markBlock()` onto it instead and
skip the wrapper. That is worth doing wherever it applies: a real element has a real box, so the
highlight overlay measures it directly rather than inferring geometry from the block's contents
(see [`limitations.md`](./limitations.md#known-gaps)).

```tsx
import {
  markBlock,
  markField,
} from "@abinnovision/payloadcms-viewfinder/client";

export const HeroModule = ({ block }) => (
  <section {...markBlock(block.id, block.blockType)}>
    <h1 {...markField("heading")}>{block.heading}</h1>
  </section>
);
```

Whichever you use, do it at every nesting level you want addressable. A block that is not marked is
simply invisible to viewfinder; clicking it resolves to the nearest marked ancestor instead.

## 5b. Mark the blocks, with montage

Montage has one dispatch choke point, and its registry exposes it as `wrapBlock`. One hook
instruments the entire tree:

```tsx
// blocks/registry.tsx
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

Three things make this a single line of wiring rather than a per-block chore.

`wrapBlock` runs at montage's one dispatch point, so it covers every nesting depth and every route
into the tree: a parent calling `renderer.Block`, an inline block, a richtext-embedded block. It
runs after all of montage's gating, so a block that renders nothing is never wrapped and no empty
marker is left behind.

`ctx.isPreview` is your own context field. Montage knows nothing about preview, and viewfinder
knows nothing about montage; the flag travels through the app's context like anything else.

The `id` cast is needed because montage's wrapper sees a block as `{ blockType?: string }`. The
value is Payload's row id and is present on every saved row.
[`packages/montage/docs/rendering.md`](../../montage/docs/rendering.md) documents `wrapBlock` in
full.

Montage does not depend on viewfinder, and viewfinder does not depend on montage. `wrapBlock` is a
generic hook; this is one use of it.

## Checking it works

Open a document in the admin and switch to the Live Preview tab. Hovering a block in the preview
outlines it; clicking it scrolls the matching form row into view, expanding whatever is collapsed
around it, and flashes it. Clicking or focusing a field in the form outlines the corresponding
block in the preview and scrolls it to the centre of the frame.

If nothing happens at all, check in this order: the import map was regenerated, the collection is
in the plugin's `collections` list, `adminOrigin` matches the admin's real origin, and the blocks
are actually marked (`data-vf-id` should be on the rendered elements when the preview flag is on).
