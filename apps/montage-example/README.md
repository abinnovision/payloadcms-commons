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

See [`packages/montage/docs`](../../packages/montage/docs) for the concepts behind all of this.

## Setup

```bash
cp .env.example .env
yarn install
yarn workspace @internal/montage-example dev
```

| Variable         | Required | Purpose                                             |
| ---------------- | -------- | --------------------------------------------------- |
| `PAYLOAD_SECRET` | yes      | Signs JWTs. Payload refuses to start without it.    |
| `DATABASE_URI`   | no       | SQLite file. Defaults to `file:./.data/montage.db`. |
| `PAYLOAD_URL`    | no       | Defaults to `http://localhost:3000`.                |

Open <http://localhost:3000/admin>, create the first user, then:

1. Create a `pages` document with a `section-wrapper` block containing a `hero-module`. Visit
   `/<slug>`; only the hero renders.
2. Add a `recent-posts-module` to the same section wrapper. Reload: it still does not render,
   because there are no `posts` documents yet, and `canRender` reads the resolver's result.
3. Create a `posts` document. Reload: the recent-posts module now renders its list. The resolver
   ran again because each request builds its own render context; see
   [`packages/montage/docs/rendering.md`](../../packages/montage/docs/rendering.md#resolving-data).

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

The whole pipeline runs: `payload generate:types` produces the slug-checked block types,
`defineBlockComponent` uses them, and `next build` succeeds with the package installed as an
ordinary workspace dependency.
