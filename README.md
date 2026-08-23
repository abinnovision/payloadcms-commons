# abinnovision/payloadcms-commons

[![Build](https://github.com/abinnovision/payloadcms-commons/actions/workflows/build.yaml/badge.svg)](https://github.com/abinnovision/payloadcms-commons/actions/workflows/build.yaml)

A collection of common packages and plugins for [Payload CMS](https://payloadcms.com/).

## Packages

| Package                                            | Description                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`@abinnovision/payloadcms-mcpx`](./packages/mcpx) | MCP server plugin with a fixed, schema-aware tool surface and draft-only writes. |

See [`packages/`](./packages) for the layout and conventions used when adding one.
Private example apps live in [`apps/`](./apps).

## Compatibility

- **Payload CMS** 3+
- **Node.js** 24+ (see [`.tool-versions`](.tool-versions))
- **Module format**: ESM (Payload itself is ESM-only), with type declarations
- **License**: Apache-2.0

## Versioning

Each package is versioned independently via
[release-please](https://github.com/googleapis/release-please). Adding a package
means registering it in [`release-please-config.json`](./release-please-config.json).

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
yarn build          # Build all packages
yarn check          # Lint, format and type checks
yarn fix            # Auto-fix lint and format issues
yarn test           # Run all tests
yarn test-unit      # Run unit tests only
yarn test-integration # Run integration tests only
yarn dev            # Start the example apps
```

## License

Apache-2.0
