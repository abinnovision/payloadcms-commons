# @abinnovision/payloadcms-viewfinder

Two-way block addressing between a rendered frontend and the [Payload CMS](https://payloadcms.com/)
admin form.

Viewfinder owns addressing and transport, and nothing else. It puts a stable identifier on each
rendered block, resolves that identifier back to a path in the admin's own form state, and carries
messages between the two windows. In the preview, hovering a block outlines and names it and
clicking anywhere inside it scrolls the matching form row into view. In the admin, hovering anywhere
in a block row outlines that block in the preview, and a button in the row header scrolls the
preview to it.

Inline editing is deliberately not part of it. A visual editor needs to know which DOM node belongs
to which field before it can do anything else, and that layer is useful on its own.
[`docs/concepts.md`](./docs/concepts.md) describes the addressing model;
[`docs/limitations.md`](./docs/limitations.md) states what is out of scope and why.

Viewfinder works in any Payload app. [`@abinnovision/payloadcms-montage`](../montage) is not
required, but when it is present its `wrapBlock` registry option makes the whole block tree
addressable in one hook. See [`docs/integration.md`](./docs/integration.md) for both paths.

## Install

```sh
yarn add @abinnovision/payloadcms-viewfinder
```

Peers: `payload >=3.88.0 <4`, `react ^19`, `react-dom ^19`. `@payloadcms/ui` is an optional peer,
needed only by the `./admin` entrypoint.

## Setup

Add the plugin in `payload.config.ts`. It mounts the admin half of the bridge inside the document
form of the collections and globals you name, defaulting to all of them:

```ts
// payload.config.ts
import { viewfinderPlugin } from "@abinnovision/payloadcms-viewfinder/config";
import { buildConfig } from "payload";

export default buildConfig({
  // ...
  plugins: [viewfinderPlugin({ collections: ["pages"] })],
});
```

Then run `payload generate:importmap`, as for any plugin that contributes admin components. Payload
resolves the bridge by import path, so it has to be in the generated map.

Configure live preview on the collection. It must be server-side live preview, which is the shape
Payload gives you by setting `admin.livePreview.url`: the iframe loads the real route, and a
`RefreshRouteOnSave` in the frontend re-renders it on the server after each save:

```ts
// collections/pages.ts
export const pages: CollectionConfig = {
  slug: "pages",
  admin: {
    livePreview: {
      url: ({ data }) => `/preview?path=/${String(data["slug"] ?? "")}`,
    },
  },
  // ...
};
```

Mount the frontend bridge once, near the root of the app. `adminOrigin` is required rather than
defaulting to `"*"`, because this window posts the ids of everything it renders:

```tsx
// app/layout.tsx
import { ViewfinderBridge } from "@abinnovision/payloadcms-viewfinder/client";

const Layout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en">
    <body>
      {children}
      <ViewfinderBridge adminOrigin="http://localhost:3000" />
    </body>
  </html>
);
```

The bridge does nothing when the page is not framed, so the same tree can be served to real
visitors without a second code path. Inside the preview it outlines the block under the pointer and
names it, and a click anywhere inside that block selects it. The whole block is the target, so a
plain click on a link inside a marked block selects rather than navigates while the page is framed.
Modified and secondary clicks are left alone, so an editor can still open a link in a new tab.

Finally, mark the blocks. Wrap each one in `<Marked>`, passing the Payload row `id` and your own
preview flag:

```tsx
import { Marked } from "@abinnovision/payloadcms-viewfinder/client";

<Marked id={block.id} blockType={block.blockType} enabled={isPreview}>
  <HeroModule block={block} />
</Marked>;
```

With `enabled={false}` the children render untouched, with no wrapper and no attributes, so
production output is unaffected by having viewfinder installed.

`Marked` adds nothing to the tree when its child is a DOM element: the attributes go onto that
element. Only a component element, a fragment, an array, text or a promise gets a
`display: contents` wrapper, since a component may not forward unknown props to any DOM node. A
block can settle it either way by spreading `markBlock()` onto its own element:

```tsx
import {
  markBlock,
  markField,
} from "@abinnovision/payloadcms-viewfinder/client";

<section {...markBlock(block.id, block.blockType)}>
  <h2 {...markField("heading")}>{block.heading}</h2>
</section>;
```

`markField` is optional and opt-in. Its argument is relative to the enclosing block (`"heading"`,
or `"items.0.label"` for something nested), never an absolute document path, which is what lets the
address survive the block moving to a different index.

## Entrypoints

```
"."        attributes, protocol, path resolution. Imports nothing.
"./client" ViewfinderBridge, Marked, markBlock, markField
"./config" viewfinderPlugin, loaded from payload.config.ts
"./admin"  ViewfinderFormBridge, mounted by the plugin through the import map
```

`.` is shared by the frontend bundle and the admin bundle, so it imports nothing at all: no React,
no Payload, no Next. `./config` is loaded by the CLI, by migrations and by `generate:types`, so it
must stay React-free. [`docs/concepts.md`](./docs/concepts.md) covers why each boundary is where it
is.

## Documentation

- [`docs/concepts.md`](./docs/concepts.md): the addressing model, the entrypoint boundaries, and
  the scope of the package.
- [`docs/integration.md`](./docs/integration.md): wiring it up, standalone and with montage,
  including the live-preview requirement.
- [`docs/limitations.md`](./docs/limitations.md): what viewfinder does not do, and why.

## License

Apache-2.0
