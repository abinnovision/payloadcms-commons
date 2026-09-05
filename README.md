# abinnovision/payloadcms-commons

![Five interchangeable building blocks, the three a project needs composed into one Payload site](https://raw.githubusercontent.com/abinnovision/payloadcms-commons/main/assets/header.png)

[![Build](https://github.com/abinnovision/payloadcms-commons/actions/workflows/build.yaml/badge.svg)](https://github.com/abinnovision/payloadcms-commons/actions/workflows/build.yaml)

Building blocks for production [Payload CMS](https://payloadcms.com/) sites.

Every package here started as code inside a Payload site running in production.
It gets pulled out into this repo once the same problem has come up on a second
site, with a boundary drawn around it on the way out.

That is why each package covers one concern and no more. You can take the one
you need without taking on the rest.

## Packages

| Package                                                                    | Description                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`@abinnovision/payloadcms-email-lettermint`](./packages/email-lettermint) | Email adapter sending transactional mail through the Lettermint API.                       |
| [`@abinnovision/payloadcms-mcpx`](./packages/mcpx)                         | MCP server over the content model, with a fixed tool surface and per-API-key capabilities. |
| [`@abinnovision/payloadcms-montage`](./packages/montage)                   | Typed block registry and RSC renderer for Payload blocks.                                  |
| [`@abinnovision/payloadcms-viewfinder`](./packages/viewfinder)             | Two-way block addressing between a rendered frontend and the Payload admin form.           |
| [`@abinnovision/payloadcms-wayfinder`](./packages/wayfinder)               | Editor-authored URL routing: collection-to-path patterns, hrefs and a link field.          |

## How they fit together

No package here depends on another. Each declares its own peers and installs on
its own, in an app that uses none of the others.

Two seams exist today, and both are optional on both sides. Montage renders every
block through a single dispatch point, and its registry exposes that point as
`wrapBlock`. Passing viewfinder's marker through it makes an entire block tree
addressable from the admin's live preview in one hook, at every nesting depth.
Montage does not depend on viewfinder and viewfinder does not depend on montage;
the hook is a plain wrapper either of them can live without. See
[`packages/viewfinder/docs/integration.md`](./packages/viewfinder/docs/integration.md)
for the two integration paths, and
[`apps/montage-example`](./apps/montage-example) for the seam in a running app.

The second is wayfinder's `./montage` entrypoint, behind an optional peer. It
parks compiled route mappings on montage's render context, so a page with dozens
of links reads them once per request rather than once per link. Without montage
the same glue is a short adapter over whatever context an app already has, and
nothing else in wayfinder knows montage exists. See
[`packages/wayfinder/docs/recipes.md`](./packages/wayfinder/docs/recipes.md) for
both paths.

mcpx and the Lettermint adapter have no seam with any of the others. A site
installs whichever of the five it needs.

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
[`packages/mcpx`](./packages/mcpx) is the fullest reference to copy from.
Private example apps live in [`apps/`](./apps).

Each package is versioned and released independently through
[release-please](https://github.com/googleapis/release-please), so a new one has
to be registered in
[`release-please-config.json`](./release-please-config.json) before it can be
released.

## License

Apache-2.0
