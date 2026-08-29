# abinnovision/payloadcms-commons

[![Build](https://github.com/abinnovision/payloadcms-commons/actions/workflows/build.yaml/badge.svg)](https://github.com/abinnovision/payloadcms-commons/actions/workflows/build.yaml)

A collection of common packages and plugins for [Payload CMS](https://payloadcms.com/).

## Packages

| Package                                                                    | Description                                                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`@abinnovision/payloadcms-email-lettermint`](./packages/email-lettermint) | Email adapter sending transactional mail through the Lettermint API.                |
| [`@abinnovision/payloadcms-mcpx`](./packages/mcpx)                         | MCP server plugin with a fixed, schema-aware tool surface and per-key capabilities. |

A new package follows the layout of an existing one: source under `src/`,
tsdown for the build, unit tests beside the source and integration tests under
`test/`. [`packages/mcpx`](./packages/mcpx) is the fuller of the two to copy
from. Private example apps live in [`apps/`](./apps).

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
