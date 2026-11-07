# example-v4

The Payload CMS v4 counterpart of [`example-v3`](../example-v3). It mounts only
the packages that already support Payload v4, and grows as more of them migrate.

| Package                                 | Where it shows up                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`montage`](../../packages/montage)     | `src/blocks/*`, the block tree rendered by the one route                                       |
| [`wayfinder`](../../packages/wayfinder) | every URL on the site, plus the links inside blocks and rich text                              |
| [`colophon`](../../packages/colophon)   | `colophonPlugin()` in `src/payload.config.ts`, the build group under the admin navigation      |
| [`dummy`](../../packages/dummy)         | `src/seed.ts` and `src/seeds/*`, run through `yarn seed`                                       |
| [`oidc`](../../packages/oidc)           | `src/auth/oidc.ts`, single sign-on when `OIDC_ISSUER` is set; `src/idp.ts` is a local provider |

The frontend is the montage and wayfinder half of the v3 site: one catch-all
route serves `pages`, `sections` and `articles` from the URL patterns authored
in the admin, in English and under a `/de` prefix. Viewfinder is left out until
it supports v4, and with it the live preview addressing and refresh-on-save.

## Setup

```bash
cp .env.example .env
yarn install
yarn workspace @internal/example-v4 seed
yarn workspace @internal/example-v4 dev
```

The site is on http://localhost:3001 and the admin panel on
http://localhost:3001/admin, so it runs next to `example-v3` on port 3000.
`seed` fills a fresh database and creates the sign-in `editor@example.com` /
`password`.

| URL                        | Serves                                                |
| -------------------------- | ----------------------------------------------------- |
| `/`                        | the `pages` document whose slug is `/`                |
| `/about/team`              | a page two levels deep, via the wildcard pattern      |
| `/topic/journal`           | a `sections` document                                 |
| `/journal/hello-world`     | an `articles` document, addressed through its section |
| `/de`, `/de/thema/journal` | the same documents in German                          |
| `/sitemap.xml`             | every published URL in both locales                   |

Changing the content model means
`yarn workspace @internal/example-v4 generate:types` too, and then `yarn fix`:
Payload writes `src/payload-types.ts` with its own formatting, which is not this
repo's.

| Variable         | Required | Purpose                                                        |
| ---------------- | -------- | -------------------------------------------------------------- |
| `PAYLOAD_SECRET` | yes      | Signs JWTs.                                                    |
| `DATABASE_URI`   | no       | SQLite file. Defaults to `file:./.data/example-v4.db`.         |
| `PAYLOAD_URL`    | no       | Base URL of this app. Defaults to `http://localhost:3001`.     |
| `APP_*`          | no       | What the colophon group shows. See `.env.example` for the set. |
| `OIDC_*`         | no       | Turns on single sign-on. See below.                            |

## Single sign-on

With `OIDC_ISSUER` unset the admin keeps its password login. To try the oidc
plugin without a real provider, start the local one and point the app at it:

```bash
yarn workspace @internal/example-v4 idp   # http://localhost:4400, approves every sign-in
OIDC_ISSUER=http://localhost:4400 OIDC_CLIENT_SECRET=local yarn workspace @internal/example-v4 dev
```

The admin then forwards to the provider and signs in as `editor@example.com`,
whose `cms-editors` group maps to the `editor` role. `IDP_GROUPS=cms-admins`
on the `idp` script signs in as an admin instead. Password login, and with it
the seeded password, is off while the plugin is on.

`src/payload-types.ts` is generated with the plugin off, and the import map
with it on, so it carries the plugin's admin components either way. Regenerate
the import map with `OIDC_ISSUER` set. `dev` rewrites `payload-types.ts` for
whatever config it runs, so do not commit the version written with the plugin
on.

## Two Payload versions in one workspace

The repository root and every package resolve Payload 3, while this app installs
Payload 4 into its own `node_modules`. The packages are linked as workspace
symlinks, so by default their own `import "payload"` resolves from
`packages/<name>/` and reaches the v3 copy at the root. That would load two
Payload instances, or check this app against the wrong types.

Each tool that resolves modules is pointed back at this app instead:

- **Next.js**: `turbopack.resolveAlias` in `next.config.mjs` resolves
  `payload`, `@payloadcms/ui` and `@payloadcms/richtext-lexical`, subpaths
  included, from this app.
- **The `payload` CLI**: the `seed` and `generate:*` scripts run Node with
  `--preserve-symlinks`, so a package resolves its imports from
  `node_modules/@abinnovision/<name>` here rather than from its real path.
- **TypeScript**: `preserveSymlinks` in `tsconfig.json` does the same for types.
  Packages that install their own Payload 4 for their tests (oidc) would still
  bring a second copy of its types, so `paths` in `tsconfig.json` points
  `payload` and `@payloadcms/ui` at this app's copies.

A package that moves to v4 and imports another Payload package needs that name
added to the aliases.

`--preserve-symlinks` also changes which copy of any other dependency a package
gets. Payload 4 installs `path-to-regexp` 6 into this app's `node_modules`,
which would shadow the version 8 wayfinder needs, so this app depends on
`path-to-regexp` 8 itself and Payload's copy moves into its own folder.
