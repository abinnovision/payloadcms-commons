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
cannot enable draft mode for themselves. `apps/example/src/app/(app)/preview/route.ts` in
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

| Prop          | Required | Purpose                                                                                                      |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `adminOrigin` | yes      | Origin of the Payload admin. Required rather than defaulting to `"*"`: this window posts the ids it renders. |

## 5. Mark the blocks

A block addresses itself, by spreading `markBlock()` onto the root element it already renders:

```tsx
import { markBlock, markField } from "@abinnovision/payloadcms-viewfinder";

export const HeroModule = ({ block }) => (
  <section {...markBlock(block.id, block.blockType)}>
    <h1 {...markField("heading")}>{block.heading}</h1>
  </section>
);
```

Import from the package root rather than `./client`. `markBlock` is a pure function returning a
plain object, and the root entrypoint carries no `"use client"`, so the block stays a server
component.

### Gate it yourself

`markBlock` always returns attributes. Two conditions are yours to enforce, and a small helper is
the tidiest place for both:

```tsx
const mark = (block, isPreview) =>
  isPreview && block.id ? markBlock(block.id, block.blockType) : {};
```

Outside preview, emit nothing, so the tree served to visitors is unaffected by having viewfinder
installed. And skip a row with no `id`: an unsaved row would emit an address that resolves to
nothing, and an empty `data-vf-id` is worse than none, because `closest("[data-vf-id]")` still
matches it and it shadows the nearest real ancestor.

### Blocks with no root element

Not every block renders one. A block that returns a fragment, an array, or a third-party component
that will not forward `data-*` has nowhere to put the address, and has to grow an element:

```tsx
export const RichTextModule = ({ block, isPreview }) => (
  <div {...mark(block, isPreview)}>
    <RichText data={block.content} />
  </div>
);
```

Add that element deliberately rather than reaching for a `display: contents` wrapper. Such a wrapper
stays out of layout but not out of the tree: it still matches `>` and `:nth-child()` selectors aimed
at the block, and the HTML parser reparents it out of a table or a paragraph. It also generates no
box, so the overlay has to infer one from a range over its children rather than measure it. See
[`limitations.md`](./limitations.md#known-gaps).

### With montage

Nothing changes. Montage renders block components, so a block that marks itself is addressable
however it was reached — nested under another block, inline, or embedded in rich text — because all
three go through the same registry entry.

```tsx
// blocks/registry.tsx
import { HeroModule } from "./HeroModule";
import { RecentPostsModule } from "./RecentPostsModule";
import { SectionWrapper } from "./SectionWrapper";
import { defineBlockRegistry } from "../montage";

export const blocks = defineBlockRegistry({
  "hero-module": HeroModule,
  "recent-posts-module": RecentPostsModule,
  "section-wrapper": SectionWrapper,
});
```

A montage block component receives both the fully typed `block` — so `block.id` needs no cast — and
`ctx`, which is where the preview flag travels. Montage knows nothing about preview and viewfinder
knows nothing about montage; the flag is the app's own context field.

Montage's `wrapBlock` is not involved. It remains a general-purpose hook
([`packages/montage/docs/rendering.md`](../../montage/docs/rendering.md)), but it hands the wrapper
an already-rendered `ReactNode` with no element to mark, so addressing belongs in the block instead.

Do this at every nesting level you want addressable. A block that is not marked is simply invisible
to viewfinder; clicking it resolves to the nearest marked ancestor instead.

## Checking it works

Open a document in the admin, switch to the Live Preview tab, and turn on the crosshair toggle in
the document controls — the feature starts off, so nothing below happens until you do. Hovering a block in the preview
outlines it and names it; clicking anywhere inside it scrolls the matching form row into view,
expanding whatever is collapsed around it, and flashes it. Going the other way, hovering anywhere
in a block row outlines that block in the preview without moving it, and the button in the row
header scrolls the preview to it.

Nothing else in the form triggers anything: typing, collapsing rows or opening a row menu leaves
the preview where it is. In the preview, a plain click inside a marked block selects it rather than
following a link; hold a modifier, or click outside every marked block, to use the page normally.

Turning the toggle back off restores all of that: the row buttons disappear, neither side outlines
anything, and a link in the preview navigates normally again. It is a per-user preference, so the
choice survives a reload and follows you to the next document. It also survives a save, which is
the case worth checking — `RefreshRouteOnSave` remounts the frontend bridge, and the admin
re-announces the setting when the fresh bridge says `ready`.

The toggle is greyed out, in Payload's own disabled style, on a document whose live preview is
closed. It disappears entirely only when the collection has no `admin.livePreview.url` at all.

If nothing happens at all, check in this order: the toggle is on, the import map was regenerated,
the collection is in the plugin's `collections` list, `adminOrigin` matches the admin's real
origin, and the blocks are actually marked (`data-vf-id` should be on the rendered elements when
the preview flag is on).
