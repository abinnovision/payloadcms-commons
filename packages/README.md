# Packages

Every published package lives in its own directory here and is a Yarn workspace
(`packages/*`). Private example apps live in `apps/*`.

## Conventions

- **Name**: `@abinnovision/payloadcms-<name>`, published to npm and the GitHub
  Package Registry with `publishConfig`.
- **License**: Apache-2.0, with a `LICENSE` copy inside the package.
- **Build**: [tsdown](https://tsdown.dev/) producing ESM output in `dist/`,
  validated by `publint` and `attw`. Packages are ESM-only because `payload`
  ships no CommonJS entry; a dual build is only an option when every runtime
  peer supports CommonJS.
- **Tests**: Vitest. Unit specs live next to the sources as `*.spec.ts` in the
  project `<package-name>#unit`. Integration tests that boot Payload live in
  `test/integration/` with their own `vitest.config.mts` in the project
  `<package-name>#integration`.
- **Payload dependencies**: `payload` and `@payloadcms/*` belong in
  `peerDependencies` (plus `devDependencies` for local builds and tests), never
  in `dependencies`.

## Layout

```
packages/<name>/
├── src/
│   └── index.ts
├── test/
│   ├── fixtures/
│   └── integration/
│       └── vitest.config.mts
├── eslint.config.mjs
├── package.json
├── tsconfig.json          # extends ../../tsconfig.base.json
├── tsconfig.build.json
├── tsdown.config.ts
├── vitest.config.mts
├── LICENSE
└── README.md
```

## Adding a package

1. Create the directory and the files above.
2. Register it in [`release-please-config.json`](../release-please-config.json) and
   [`.release-please-manifest.json`](../.release-please-manifest.json).
3. Add it to the package table in the [root README](../README.md).
4. Run `yarn install` to link the workspace.
