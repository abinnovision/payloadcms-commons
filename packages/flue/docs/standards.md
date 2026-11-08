# Standards

These rules apply to code in this package.

## Entries and layers

The package has three entries, and each runs somewhere else. A boundary spec per entry walks its
module graph:

| Entry     | Spec                                | Must not reach                                                                                         |
| --------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `.`       | `src/module-boundary.spec.ts`       | a `.tsx` file, `react`, `@payloadcms/ui`, `@assistant-ui/*`, `@flue/*`, `valibot` (type-only included) |
| `./admin` | `src/admin/module-boundary.spec.ts` | a runtime import of `payload`, `node:*`, `next/*`, `@flue/*` except `@flue/sdk`, `valibot`             |
| `./agent` | `src/agent/module-boundary.spec.ts` | `payload` (type-only included), `@payloadcms/*`, `react`, `node:*`; only `@flue/runtime` and `valibot` |

Inside the server entry, `src/layering.spec.ts` holds each file to its layer. A file imports its
own layer and lower ones, type-only imports included:

| Layer | Members                                      |
| ----- | -------------------------------------------- |
| 0     | `protocol/`, which imports no package at all |
| 1     | `types.ts`, `options.ts`                     |
| 2     | `threads/`, `keys/`, `sidecar/`              |
| 3     | `turn.ts`                                    |
| 4     | `endpoints/`, `jobs/`                        |
| 5     | `plugin.ts`, `index.ts`                      |

`admin/` and `agent/` stand outside the layers and may import only `protocol/` from the rest of
`src/`. The rules are written three times: `layering.spec.ts`, the `no-restricted-imports` rules
in `eslint.config.ts` and the boundary specs. A change belongs in all three. Each spec has a
sanity case that fails if its walk finds nothing.

## Tests

Unit specs sit beside the source file they test and test one module through its exports.
Integration specs live in `test/integration`. They boot Payload 4 on SQLite in memory with mcpx and
flue from `test/fixtures/config.ts`, and go through the plugin's endpoints, the MCP endpoint or the
Local API against a fake sidecar on `node:http` (`test/integration/helpers/sidecar.ts`).

The repository root holds Payload 3, so the package resolves Payload 4 from `apps/example-v4`, as
mcpx's v4 lane does. Both vitest configs load `payload` and `@payloadcms/*` from there through
`payloadV4Resolver` (`@internal/test-utils/payload-v4`), so the workspace-linked mcpx and flue
share one Payload instance. `payload` and `@payloadcms/ui` are `link:` devDependencies into the
example's `node_modules`, so Node resolves the example's copy from `dist` at run time, which the
example's `next dev` needs. `tsconfig.json` maps the same packages to the example's declarations,
and `turbo.json` lists the example's `package.json` as an input of every task that resolves
Payload.

A unit spec may build config objects but never boots Payload. A structural stub, such as a config,
a logger or a `fetch` that answers fixed responses, is fine. If the test needs a fake with
behaviour, such as a database or Payload operations, it belongs in integration.
`@payloadcms/ui` may be mocked in admin specs.

Flue's wire format is pinned by recordings in `test/fixtures`: `flue-updates*.sse`,
`flue-history*.json`, `flue-send-stale-uid.json` (a send refused for a stale `uid`) and
`flue-observe-settled.json` (settlements as an `observe()` subscriber receives them). They were
captured from real Flue runs and committed unedited except for redacted provider ids, keys and
local paths. Parsing, the sidecar client, the stream observer, the converter, the conversation observer, the fake
sidecar, the settlement reporter and the panel are tested against them. Record them again when
Flue is upgraded; do not hand-edit them.

A builder used by two specs moves to `test/builders`.

Assert what a caller can observe. Do not assert call counts, hook identity, CSS classes or
private fields. A log line is an outcome an operator sees, so a test may assert what a logger stub
received.

`describe` names the export or the endpoint. `it` states the behaviour in lowercase present tense:
`it("refuses a thread of another user")`.

Every test passes when run alone and in any order.

Every access rule has a test with two users, one allowed and one refused. Every test of a refusal
also asserts that nothing was written or forwarded to the sidecar.

## Build

tsdown keeps `dist` between builds (`clean: false`), so the example's `next dev` keeps resolving
the package while it rebuilds. Files of deleted modules stay in `dist` until it is removed. The
package has no `clean` script. Before publishing by hand, run `yarn clean` at the repository
root, which removes `dist`, `coverage` and `.turbo` of every package and `.next` of the apps.

## Comments

A comment says why, or states a constraint the code cannot show. It describes the current code
only, never its history.

- `/** */` on exports, one to four lines.
- `/* */` for a block inside a function.
- `//` for a single line.

Longer rationale goes in `docs/`. Do not use em-dashes.

## Errors

- An endpoint returns `refusal(status, message)` for an outcome the caller can act on. Every
  refusal has the body `{ error }`.
- Shared code such as `turn.ts` throws a public `APIError`; `endpointHandler` answers it as a
  refusal with its status and message.
- Option and config checks throw `InvalidConfiguration` with the prefix `[payloadcms-flue]`.
- Sidecar failures become `SidecarError`, and exchange failures in the sidecar
  `FlueExchangeError`, each with the status that was answered.

Anything else reaches Payload's error handler. No message or log line carries the sidecar secret,
a handle, an mcpx key or a sidecar response body.
