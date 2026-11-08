# example-v4

The Payload CMS v4 counterpart of [`example-v3`](../example-v3). It mounts only
the packages that already support Payload v4, and grows as more of them migrate.

| Package                                 | Where it shows up                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`montage`](../../packages/montage)     | `src/blocks/*`, the block tree rendered by the one route                                       |
| [`wayfinder`](../../packages/wayfinder) | every URL on the site, plus the links inside blocks and rich text                              |
| [`colophon`](../../packages/colophon)   | `colophonPlugin()` in `src/payload.config.ts`, the build group under the admin navigation      |
| [`mcpx`](../../packages/mcpx)           | `mcpxPlugin()` in `src/payload.config.ts`, how the agents reach the content                    |
| [`dummy`](../../packages/dummy)         | `src/seed.ts` and `src/seeds/*`, run through `yarn seed`                                       |
| [`oidc`](../../packages/oidc)           | `src/auth/oidc.ts`, single sign-on when `OIDC_ISSUER` is set; `src/idp.ts` is a local provider |
| [`flue`](../../packages/flue)           | `src/agents.ts`, the chat panel in the admin and the run queued on publishing an article       |

The frontend is the montage and wayfinder half of the v3 site: one catch-all
route serves `pages`, `sections` and `articles` from the URL patterns authored
in the admin, in English and under a `/de` prefix. Viewfinder is left out until
it supports v4, and with it the live preview addressing and refresh-on-save.

## Setup

```bash
cp .env.example .env
# Set FLUE_SIDECAR_SECRET, see "Agents" below.
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

## Agents

The admin chats with the three agents of
[`example-v4-agents`](../example-v4-agents), a Flue sidecar on port 3101 that
reaches this app only through mcpx. Both apps need the same
`FLUE_SIDECAR_SECRET`, at least 32 characters, and the sidecar needs a provider
key:

```bash
cp .env.example .env
cp ../example-v4-agents/.env.example ../example-v4-agents/.env
# Set FLUE_SIDECAR_SECRET in both files, ANTHROPIC_API_KEY in the sidecar's.
yarn workspace @internal/example-v4 seed
yarn turbo run dev --filter=@internal/example-v4
```

`dev` starts the sidecar alongside, through `with` in `turbo.json`.

Sign in at http://localhost:3001/admin and open the chat panel with the chat
button or Ctrl/Cmd+J.

| User                   | Password | Sees                                                    |
| ---------------------- | -------- | ------------------------------------------------------- |
| `editor@example.com`   | password | `editor`, `summarizer` and the threads of agent runs    |
| `reviewer@example.com` | password | all three agents and the threads of agent runs          |
| `agent@example.com`    | random   | nobody signs in as it; runs started by a hook act as it |

`editor` reads, edits, publishes and deletes every collection and global mcpx
exposes. Deleting waits for an approval on the mcpx key's edit view, which the
chat links to. Asked for a file, it writes Markdown to the `documents` upload
collection, and asked to keep a file attached to the message, it saves images
to `media` and PDFs to `documents`; the chat shows either as a card. The chat
takes images and PDFs as attachments.
`reviewer` only reads, and only users with "Agent access" ticked see it; the
seed sets that box, which neither the admin nor the API can change.
`summarizer` only reads, and every user sees it. Publishing an article queues a
run of `summarizer` as `agent@example.com` on behalf of the publisher, which
`jobs.autoRun` picks up within a minute. Every signed-in user reads agent runs,
so the run shows read-only on the Runs tab of the chat panel's Threads view.

| Variable              | Required | Purpose                                                         |
| --------------------- | -------- | --------------------------------------------------------------- |
| `FLUE_SIDECAR_SECRET` | yes      | Shared with the sidecar. Payload refuses to start without it.   |
| `FLUE_SIDECAR_URL`    | no       | Where the sidecar listens. Defaults to `http://localhost:3101`. |

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
  Packages that install their own Payload 4 for their tests (oidc, flue) would
  still bring a second copy of its types, so `paths` in `tsconfig.json` points
  `payload` and `@payloadcms/ui` at this app's copies.

A package that moves to v4 and imports another Payload package needs that name
added to the aliases.

`--preserve-symlinks` also changes which copy of any other dependency a package
gets. Payload 4 installs `path-to-regexp` 6 into this app's `node_modules`,
which would shadow the version 8 wayfinder needs, so this app depends on
`path-to-regexp` 8 itself and Payload's copy moves into its own folder.
