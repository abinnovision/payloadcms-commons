# wayfinder-example

Example Payload app mounting
[`@abinnovision/payloadcms-wayfinder`](../../packages/wayfinder).

It exists to show the claim the package is built around: that routing can be
authored by an editor rather than written in code. There is exactly one route
file, `src/app/(app)/[[...segments]]/page.tsx`, and it names no collection and
no URL shape.

## Run

```sh
cp .env.example .env
yarn workspace @internal/wayfinder-example generate:importmap
yarn workspace @internal/wayfinder-example dev
```

Open `/admin`, create the first user, then:

1. Add a **Section** with slug `journal`.
2. Add a **Page** with slug `/` (the home page) and another with `/about/team`.
3. Add an **Article** in the `journal` section with slug `hello-world`.
4. Open **Settings → Collections Mapping** and add three rows:

   | Collection | Path              |
   | ---------- | ----------------- |
   | `pages`    | `/*slug`          |
   | `sections` | `/topic/:slug`    |
   | `articles` | `/:section/:slug` |

Now `/`, `/about/team`, `/topic/journal` and `/journal/hello-world` all resolve,
without a route file for any of them.

## What to try

- **Change a pattern.** Edit the `articles` row to `/writing/:section/:slug`.
  The article moves, and any link pointing at it moves with it, because links
  resolve through the same mapping.
- **Watch specificity work.** `/about/team` matches both `/:section/:slug` and
  the `pages` wildcard. The more specific pattern is tried first, finds no
  article, and the lookup falls through to the page rather than 404ing.
- **Remove the `pages` row.** The home page stops resolving, since a bare
  wildcard is what claims `/`.

## Notes

This app has no `localization` block, so the mapping holds one pattern per
collection rather than one per locale. That is why `localized: false` is passed
in both `payload.config.ts` and `src/wayfinder.ts` — the write side and the read
side have to agree.
