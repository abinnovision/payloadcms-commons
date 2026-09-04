# montage example

A Payload CMS app mounting [`@abinnovision/payloadcms-montage`](../../packages/montage) against a
content model big enough to exercise a real data resolver and the collapse pattern rather than a
single static block.

| Block                 | Kind                             | Demonstrates                                                                                                                         |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `hero-module`         | registered in `config.blocks`    | the baseline: slug-checked, no resolver                                                                                              |
| `recent-posts-module` | registered in `config.blocks`    | a real `resolve` (fetches `posts` via a fresh `getPayload` call) plus a `canRender` that collapses the block when there are no posts |
| `section-wrapper`     | inline, never in `config.blocks` | filtering its modules through `renderer.canRender` before rendering (`packages/montage/docs/recipes.md`)                             |

`pages.layout` references `section-wrapper` by object, not by slug, since the section wrapper is
instantiated per host rather than shared through `config.blocks`.

It also mounts [`@abinnovision/payloadcms-viewfinder`](../../packages/viewfinder), so the same
blocks are addressable from the admin's live preview. One `wrapBlock` on the registry
(`src/blocks/registry.tsx`) marks the whole tree; nothing else in the app changes.

See [`packages/montage/docs`](../../packages/montage/docs) for the concepts behind all of this.

## Setup

```bash
cp .env.example .env
yarn install
yarn workspace @internal/montage-example generate:importmap
yarn workspace @internal/montage-example dev
```

`generate:importmap` is needed because `viewfinderPlugin` contributes an admin component, and
Payload resolves admin components through the generated import map. Re-run it whenever the set of
plugins that contribute components changes.

| Variable         | Required | Purpose                                                    |
| ---------------- | -------- | ---------------------------------------------------------- |
| `PAYLOAD_SECRET` | yes      | Signs JWTs. Payload refuses to start without it.           |
| `DATABASE_URI`   | no       | SQLite file. Defaults to `file:./.data/montage.db`.        |
| `PAYLOAD_URL`    | no       | Base URL of this app. Defaults to `http://localhost:3000`. |

`PAYLOAD_URL` does double duty: its origin is the `adminOrigin` the viewfinder bridge trusts, so
set it if you serve the admin from anywhere other than the default.

Open <http://localhost:3000/admin>, create the first user, then:

1. Create a `pages` document with a `section-wrapper` block containing a `hero-module`. Visit
   `/<slug>`; only the hero renders.
2. Add a `recent-posts-module` to the same section wrapper. Reload: it still does not render,
   because there are no `posts` documents yet, and `canRender` reads the resolver's result.
3. Create a `posts` document. Reload: the recent-posts module now renders its list. The resolver
   ran again because each request builds its own render context; see
   [`packages/montage/docs/rendering.md`](../../packages/montage/docs/rendering.md#resolving-data).
4. Open that `pages` document in the admin and switch to the Live Preview tab. Hover a block in
   the preview: it is outlined, with its slug in the corner. Click it: the matching row in the
   `layout` field expands if it was collapsed, scrolls into view, and flashes. Going back the
   other way, hover a block row in the form: that block is outlined in the preview where it
   stands. Click the button in the row header: the preview scrolls it to the centre of the frame.

## What this app demonstrates

`payload.config.ts` never imports React. `montagePlugin` comes from the `./config` entrypoint and
only appends to `config.blocks`; the section wrapper is passed to `pages.layout`'s
`blockReferences` by object instead, since it is instantiated per host.

No block component depends on Next either. `HeroModule` and `RecentPostsModule` reach `next/link`
through the render context (`src/montage.ts`'s `AppContext`), injected once in
`src/app/(app)/[slug]/page.tsx` and never imported directly.

`RecentPostsModule.resolve` is a real data resolver. It calls `getPayload` and `payload.find`
itself, because montage takes no `io` and does not fetch on a consumer's behalf. `SectionWrapper`
then filters its modules with `renderer.canRender` before rendering, so a module whose resolver
returns nothing never leaves an empty gap.

Live preview is server-side, deliberately. `pages.admin.livePreview.url` points at
`src/app/(app)/preview/route.ts`, which enables Next's draft mode behind the Payload session the
admin already holds and hands off to the real route; `RefreshOnSave` then asks Next to re-render on
the server after each save. Client-side live preview would hand the page a freshly deserialised
document, and montage keys resolver results by object identity, so nothing resolved would survive.

Viewfinder rides on that with two mount points and no per-block work: `wrapBlock` in
`src/blocks/registry.tsx` and `<ViewfinderBridge>` in `src/app/(app)/layout.tsx`. Both are inert
outside preview, so the tree served to real visitors is the same tree.

The whole pipeline runs: `payload generate:types` produces the slug-checked block types,
`defineBlockComponent` uses them, and `next build` succeeds with the package installed as an
ordinary workspace dependency.
