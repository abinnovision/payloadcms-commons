# @abinnovision/payloadcms-montage

![A flat list of Payload blocks passes through a slug-to-component registry and comes out as a rendered React tree](https://raw.githubusercontent.com/abinnovision/payloadcms-commons/main/packages/montage/assets/header.png)

Typed block registry and RSC renderer for [Payload CMS](https://payloadcms.com/).

Montage knows about Payload blocks and nothing else. It does not model pages, sections,
templates, or reusable blocks. Those are things you build with Payload's own primitives; montage
renders whatever you built. See [`docs/concepts.md`](./docs/concepts.md) for the boundary and
[`docs/recipes.md`](./docs/recipes.md) for how to rebuild those patterns on top of it.

## Install

```sh
yarn add @abinnovision/payloadcms-montage
```

Peers: `payload >=3.88.0 <4`, `react ^19`. `@payloadcms/richtext-lexical` is an optional peer,
needed only if you use the `./lexical` entrypoint.

Run `payload generate:types` before typechecking your project. Montage's slug checking depends
on your generated types; without them, `defineBlockRegistry` fails to compile with a message
telling you to run it.

## Setup

Bind the package to your own context shape once, at module scope:

```ts
// montage.ts
import { createMontage } from "@abinnovision/payloadcms-montage";

export interface AppContext {
  locale: string;
  draft: boolean;
}

export const {
  defineBlockComponent,
  defineInlineBlockComponent,
  defineBlockRegistry,
  createRenderer,
} = createMontage<AppContext>();
```

Define a block component. The slug is checked against your generated types, and the block's
props are inferred from it:

```tsx
// blocks/HeroModule.tsx
import { defineBlockComponent } from "../montage.js";

export const HeroModule = defineBlockComponent("hero-module", {
  component: ({ block }) => <h1>{block.title}</h1>,
});
```

Register your components and render:

```tsx
import { defineBlockRegistry, createRenderer } from "./montage.js";
import { HeroModule } from "./blocks/HeroModule.js";

const blocks = defineBlockRegistry({ "hero-module": HeroModule });
const renderer = createRenderer(blocks);

export default async function Page({ data, ctx }) {
  await renderer.resolveBlockData({ root: data, ctx });
  return <renderer.Block block={data} ctx={ctx} />;
}
```

Register your blocks in `payload.config.ts` through the `./config` entrypoint, which never
imports React:

```ts
// payload.config.ts
import { buildConfig } from "payload";
import { montagePlugin } from "@abinnovision/payloadcms-montage/config";
import { heroModuleBlock } from "./blocks/hero-module.config.js";

export default buildConfig({
  // ...
  plugins: [montagePlugin({ blocks: [heroModuleBlock] })],
});
```

## Documentation

- [`docs/concepts.md`](./docs/concepts.md) — the registry, the render context, and the boundary.
- [`docs/rendering.md`](./docs/rendering.md) — `defineBlockComponent`, inline blocks, resolvers,
  the render context, and the collapse rule.
- [`docs/recipes.md`](./docs/recipes.md) — rebuilding section wrappers, global references, page
  layouts, and document templates on top of montage.
- [`docs/limitations.md`](./docs/limitations.md) — what montage does not do, and why.

## License

Apache-2.0
