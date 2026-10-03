# abinnovision/payloadcms-commons

![Interchangeable building blocks, the ones a project needs composed into one Payload site](https://raw.githubusercontent.com/abinnovision/payloadcms-commons/main/assets/header.png)

[![Build](https://github.com/abinnovision/payloadcms-commons/actions/workflows/build.yaml/badge.svg)](https://github.com/abinnovision/payloadcms-commons/actions/workflows/build.yaml)

Building blocks for production [Payload CMS](https://payloadcms.com/) sites.

Plugins built to be used together on the same site, each covering one concern and
each installing on its own. Take the one you need or take all of them. Nothing
here requires anything else here.

## Packages

| Package                                                                    | Description                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`@abinnovision/payloadcms-colophon`](./packages/colophon)                 | System metadata in the admin sidebar, read from the environment at request time.           |
| [`@abinnovision/payloadcms-email-lettermint`](./packages/email-lettermint) | Email adapter sending transactional mail through the Lettermint API.                       |
| [`@abinnovision/payloadcms-mcpx`](./packages/mcpx)                         | MCP server over the content model, with a fixed tool surface and per-API-key capabilities. |
| [`@abinnovision/payloadcms-montage`](./packages/montage)                   | Typed block registry and RSC renderer for Payload blocks.                                  |
| [`@abinnovision/payloadcms-viewfinder`](./packages/viewfinder)             | Two-way block addressing between a rendered frontend and the Payload admin form.           |
| [`@abinnovision/payloadcms-wayfinder`](./packages/wayfinder)               | Editor-authored URL routing: collection-to-path patterns, hrefs and a link field.          |

## Names

Packages publish as `@abinnovision/payloadcms-<name>`. A package that wraps
something already named keeps that name: `mcpx` for the MCP protocol,
`email-lettermint` for the Lettermint API. The others take a word from film and
printing for the job they do, and each README opens by saying what the word
means.

## How they fit together

They are built for the same site, so where two of them meet the seam is already
there. A montage block component spreads viewfinder's `markBlock()` onto the
element it already renders, which makes every block addressable from live preview
at every nesting depth. Wayfinder's `./montage` entrypoint parks compiled route
mappings on montage's render context, so a page reads them once per request
rather than once per link.

Those are the only seams, and each is optional from either side. Neither package
knows the other exists: a block marks itself the same way without montage
([wiring](./packages/viewfinder/docs/integration.md)), and without montage
wayfinder's glue is a short adapter over whatever context the app already has
([both paths](./packages/wayfinder/docs/recipes.md)). colophon, mcpx and the
Lettermint adapter touch nothing else at all.

[`apps/example`](./apps/example) mounts every package but the Lettermint adapter,
with the seams wired and a seed that leaves a routed, localized site to click
through.

## Compatibility

- **Payload CMS** 3+
- **Node.js** 24+ (see [`.tool-versions`](.tool-versions))
- **Module format**: ESM (Payload itself is ESM-only), with type declarations
- **License**: Apache-2.0

## Development

Yarn 4 monorepo with [Turbo](https://turbo.build/).

### Prerequisites

- Node.js 24+
- [Corepack](https://nodejs.org/api/corepack.html) enabled (`corepack enable`)

### Setup

```bash
yarn install
```

### Commands

```bash
yarn build            # Build all packages
yarn check            # Lint, format and type checks
yarn fix              # Auto-fix lint and format issues
yarn test             # Run all tests
yarn test-unit        # Run unit tests only
yarn test-integration # Run integration tests only
yarn dev              # Start the example apps in apps/
```

### Adding a package

A new package follows the layout of an existing one: source under `src/`, tsdown
for the build, unit tests beside the source and integration tests under `test/`.
[`packages/mcpx`](./packages/mcpx) is the fullest reference to copy from. The
private example app in [`apps/example`](./apps/example) is where a new package
gets exercised against the others.

Each package is versioned and released independently through
[release-please](https://github.com/googleapis/release-please), so a new one has
to be registered in
[`release-please-config.json`](./release-please-config.json) before it can be
released.

## License

Apache-2.0
