# example

One Payload CMS app mounting every package in this repo except the Lettermint
adapter, which has no seam with the others and no frontend surface.

Each package still installs on its own. This app exists to show what happens
when a site takes several of them: where they touch, and what stays separate.

| Package                                   | Where it shows up                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| [`montage`](../../packages/montage)       | `src/blocks/*`, the block tree rendered by the one route                             |
| [`viewfinder`](../../packages/viewfinder) | one `wrapBlock` in `src/blocks/registry.tsx`, one `<ViewfinderBridge>` in the layout |
| [`wayfinder`](../../packages/wayfinder)   | every URL on the site, plus the links inside blocks and rich text                    |
| [`mcpx`](../../packages/mcpx)             | `POST /api/mcpx`, and the **MCP** group in the admin panel                           |

## Setup

```bash
cp .env.example .env
yarn install
yarn workspace @internal/example generate:importmap
yarn workspace @internal/example seed
yarn workspace @internal/example dev
```

`generate:importmap` is required: three packages contribute admin components
(viewfinder's form bridge, wayfinder's link-label plugin, mcpx's setup guide),
and Payload resolves those through the generated import map. Re-run it whenever
the set of plugins that contribute components changes.

`seed` fills a fresh database and prints the sign-in it created
(`editor@example.com` / `password`).

Changing the content model means `yarn generate:types` too, and then `yarn fix`:
Payload writes `src/payload-types.ts` with its own formatting, which is not this
repo's.

| Variable         | Required | Purpose                                                                           |
| ---------------- | -------- | --------------------------------------------------------------------------------- |
| `PAYLOAD_SECRET` | yes      | Signs JWTs, and the mcpx API key index derives from it. Rotating it orphans keys. |
| `DATABASE_URI`   | no       | SQLite file. Defaults to `file:./.data/example.db`.                               |
| `PAYLOAD_URL`    | no       | Base URL of this app. Defaults to `http://localhost:3000`.                        |

`PAYLOAD_URL` does double duty: its origin is the `adminOrigin` the viewfinder
bridge trusts, and it is what the mcpx setup guide prints as an absolute
endpoint URL. Set it if you serve the admin from anywhere else.

## What the seed leaves you

| URL                        | Serves                                                |
| -------------------------- | ----------------------------------------------------- |
| `/`                        | the `pages` document whose slug is `/`                |
| `/about/team`              | a page two levels deep, via the wildcard pattern      |
| `/topic/journal`           | a `sections` document                                 |
| `/journal/hello-world`     | an `articles` document, addressed through its section |
| `/de`, `/de/thema/journal` | the same documents in German                          |
| `/sitemap.xml`             | every published document, in both locales             |

There is one route file, `src/app/(app)/[[...segments]]/page.tsx`, and it names
no collection and no URL shape. `src/app/(app)/sitemap.ts` names three, because
a sitemap has to enumerate what a catch-all can afford to discover.

## Things to try

**Move a URL without touching code.** Open **Settings → Collections Mapping**
and change the `articles` row to `/writing/:section/:slug`. The article moves,
and the call-to-action on `/about/team` moves with it, because links resolve
through the same mapping the route matched.

The pattern is localized, so that edit moves the English URL only:
`/de/journal/hello-world` keeps working and `/de/writing/hello-world` does not
exist. Switch the admin panel to German and edit the row again to move both.
One pattern per locale is the point of a localized mapping — it is what lets
the German article live at `/thema/…` rather than at a translated slug under an
English path.

**Watch a block collapse.** `recent-posts-module` declares a resolver, and
`canRender` reads its result. Delete every `posts` document and the module
disappears; delete the hero next to it and the whole `section-wrapper`
disappears, because it filters its children through `renderer.canRender` before
rendering.

**Address a block from live preview.** Open a page and switch to the Live
Preview tab. Hover a block in the preview: it is outlined, with its slug in the
corner. Click it: the matching row in the `layout` field expands, scrolls into
view and flashes. Going the other way, hover a block row in the form and that
block is outlined in the preview. It works on the `callout` inside the rich text
too, at whatever depth it sits.

**Write over MCP.** Create a key under **MCP → API Keys**, tick `pages` read,
write and publish, then:

```bash
claude mcp add --transport http payload http://localhost:3000/api/mcpx \
  --header "Authorization: Bearer <key>"
```

`describeSchema` on `pages` stops at `/layout` and names the block slugs;
`/layout/section-wrapper/modules/hero-module` descends into one. `createDocument`
leaves a draft, which 404s on the site, and `publishDocument` makes it routable
at whatever URL the mapping says it lives at. Try `publishDocument` on `posts`
and the tool is not there: `posts` is configured `write: "draft"`, so its drafts
only go live through the admin panel.

## The two seams

Neither package knows about the other. Both hooks are plain wrappers either side
can live without.

**montage → viewfinder.** `src/blocks/registry.tsx` passes viewfinder's `Marked`
through montage's `wrapBlock`. Montage has one dispatch point for every block at
every depth, so that single hook makes the whole tree addressable — nested
modules and richtext-embedded blocks included. Outside preview `Marked` renders
its children untouched, so the tree served to visitors is the same tree.
`packages/viewfinder/docs/integration.md` has the per-block version for an app
without montage.

**wayfinder → montage.** The route calls `initWayfinder` once, which parks a
wayfinder router on the render context with the mappings, the locale and the
href formatter already bound into it. `src/components/AppLink.tsx` reads it
back with `wayfinderFrom(ctx)` and is the only file that does. A page with
dozens of links reads the mapping global once per request rather than once per
link, and no block component imports wayfinder at all.

Binding is what makes that safe rather than merely tidy. Resolving a link
builds an href internally, so a caller handed the mappings but not the href
formatter produces links that quietly leave the locale — or leave preview — on
the first click. There is no way to hand a block half of it.

Every link the site renders goes through that one component, including the ones
typed into rich text — `router.linkNode` unwraps a Lexical node into the same
link data and hands off to the same resolution, so the two cannot disagree.
`src/wayfinder.ts` holds the one description of what a router here is made of,
memoised per request, which is what the sitemap and the preview route build
theirs from.

## Decisions worth knowing about

**Live preview is server-side.** `livePreview.url` points at
`src/app/(app)/preview/route.ts`, which enables Next's draft mode behind the
Payload session the admin already holds and hands off to the real route.
Client-side live preview would give the page a freshly deserialised document,
and montage keys resolver results by object identity, so nothing resolved would
survive the round trip.

That route also computes where to send the browser from the mapping rather than
taking a path as a parameter, so preview follows the pattern an editor authored
instead of a second copy of it written into the collection config. It refuses
to redirect anywhere that is not a same-origin path: the target is built from a
slug an editor can type, and a slug beginning `//` would otherwise compile into
a URL pointing off the site.

**The locale prefix lives in `formatHref`, not in the patterns.** The German
mapping rows carry translated segments (`/thema/:slug`), not a `/de` prefix.
`src/locales.ts` strips the prefix off the incoming path and puts it back on
every path the site emits. Authoring `/de/*slug` as a pattern would work for
every URL but one: a wildcard cannot match an empty rest, so the German home
page would be unreachable.

The two halves are inverses, and `src/locales.spec.ts` is what keeps them so.
The root is the case that breaks first: a prefix concatenated onto `/` builds
`/de/`, and nothing normalises trailing slashes, so that URL matches no pattern
at all.

`formatHref` reaches every path the site emits because it is bound into the
router once, in `src/wayfinder.ts`, rather than passed to each call. That file
is the only description of what a router here is made of, so nothing can build
one with the mappings and without the formatter.

**`payload.config.ts` never imports React.** Every plugin comes from an
entrypoint that is free of it. Block components in turn never import Next:
`Link` reaches them through the render context in `src/montage.ts`, injected
once by the route.

**Metadata and the sitemap come from the same mapping the route matched.**
`generateMetadata` emits the canonical URL and an `hreflang` alternate per
locale, and `src/app/(app)/sitemap.ts` enumerates every published document in
both. Both build their URLs by asking the mapping, so moving a pattern in the
admin panel moves the canonical tag and the sitemap entry with it. The sitemap
is the one caller that has to know which collections keep versions: `sections`
has none, so filtering it on `_status` would query a column that does not
exist.

**Localization is on the document, not on block chrome.** `pages.title`,
`posts.content` and `rich-text-module.content` are localized; a hero's title is
not. Localizing a required field inside a shared blocks array means every
locale has to fill it before the document will save, which is a real choice a
site makes rather than a default worth demonstrating.
