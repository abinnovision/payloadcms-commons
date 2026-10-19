# example-v4

The Payload CMS v4 counterpart of [`example-v3`](../example-v3). It mounts only
the packages that already support Payload v4, and grows as more of them migrate.

| Package                               | Where it shows up                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`colophon`](../../packages/colophon) | `colophonPlugin()` in `src/payload.config.ts`, the build group under the admin navigation |
| [`dummy`](../../packages/dummy)       | `src/seed.ts` and `src/seeds/*`, run through `yarn seed`                                  |

There is no frontend: montage, viewfinder and wayfinder are what the v3 site is
built from, and none of them supports v4 yet.

## Setup

```bash
cp .env.example .env
yarn install
yarn workspace @internal/example-v4 seed
yarn workspace @internal/example-v4 dev
```

The admin panel is on http://localhost:3001/admin, so it runs next to
`example-v3` on port 3000. `seed` fills a fresh database and creates the sign-in
`editor@example.com` / `password`.

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

## Two Payload versions in one workspace

The repository root and every package resolve Payload 3, while this app installs
Payload 4 into its own `node_modules`. The packages are linked as workspace
symlinks, so by default their own `import "payload"` resolves from
`packages/<name>/` and reaches the v3 copy at the root. That would load two
Payload instances, or check this app against the wrong types.

Each tool that resolves modules is pointed back at this app instead:

- **Next.js**: `turbopack.resolveAlias` in `next.config.mjs` resolves `payload`
  and `@payloadcms/ui`, subpaths included, from this app.
- **The `payload` CLI**: the `seed` and `generate:*` scripts run Node with
  `--preserve-symlinks`, so a package resolves its imports from
  `node_modules/@abinnovision/<name>` here rather than from its real path.
- **TypeScript**: `preserveSymlinks` in `tsconfig.json` does the same for types.

A package that moves to v4 and imports another Payload package, such as
`@payloadcms/richtext-lexical`, needs that name added to the aliases.
