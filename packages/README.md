# Packages

Every published package lives in its own directory here and is a Yarn workspace
(`packages/*`).

## Conventions

- **Name**: `@abinnovision/payload-<name>`, published to npm and the GitHub
  Package Registry with `publishConfig`.
- **License**: Apache-2.0, with a `LICENSE` copy inside the package.
- **Build**: [tsdown](https://tsdown.dev/) producing dual ESM/CJS output in `dist/`,
  validated by `publint` and `attw`.
- **Tests**: Vitest, project named `<package-name>#unit`, spec files next to the
  sources as `*.spec.ts`.
- **Payload dependencies**: `payload` and `@payloadcms/*` belong in
  `peerDependencies` (plus `devDependencies` for local builds), never in
  `dependencies`.

## Layout

```
packages/<name>/
├── src/
│   └── index.ts
├── eslint.config.mts
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
