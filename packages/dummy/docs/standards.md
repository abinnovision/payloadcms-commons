# Standards

These rules apply to code in this package.

## Tests

Unit specs sit beside the source file they test and test one module through its exports.
Integration specs live in `test/integration`. They boot Payload on SQLite, in memory, and go
through the library or the CLI.

A unit spec may build the fixture config but never boots Payload. A structural stub, such as a
config or a `find` that answers from a map, is fine. If the test needs a fake with behaviour,
such as a database or Payload's write path, it belongs in integration.

There is **no writer fake anywhere**. Everything that decides what to write is pure and reachable
without one; everything that proves what ended up stored needs a real database. A spec that
wanted a writer fake would be testing neither.

A builder used by two specs moves to `test/builders`.

Assert what a caller can observe. Do not assert call counts, hook identity or private fields. A
reporter line is an outcome an operator sees, so a test may assert what a reporter stub received,
and `index-store.spec.ts` may count queries because caching is the behaviour under test.

`describe` names the export. `it` states the behaviour in lowercase present tense:
`it("refuses a ref in the natural key field")`.

Every test passes when run alone and in any order. That is sharper here than usual: specs in a
file share one database, so a test that reuses another's natural keys will resolve a reference
from the database and pass for the wrong reason. Give each test its own keys.

Every test of a refusal also asserts that nothing was written.

Fixtures carry no content of their own. A collection exists in `test/fixtures` for exactly one
reason, and that reason is written next to it.

## Comments

A comment says why, or states a constraint the code cannot show. It describes the current code
only, never its history.

- `/** */` on exports, one to four lines.
- `/* */` for a block inside a function.
- `//` for a single line.

Longer rationale goes in `docs/`. Do not use em-dashes.

## Errors

Every message an operator reads is prefixed `[payloadcms-dummy]` by `fail`, so its source is
never in doubt.

- Call `fail` for a mistake in the seed itself: a duplicate unit id, a cycle, an ambiguous
  natural key, a reference in a key field. These are refused before anything is written.
- Decorate a Payload error with `decorate`, which names the document that caused it and keeps the
  original as `cause`. A bare `ValidationError` says a document is invalid but not which one, and
  a run writes dozens.
- Say what to change. A cycle error names a path through the cycle; an unresolved reference lists
  the keys that do exist; a pruned required field names the `dependsOn` that would fix it.

Throw rather than report. A failed run stops at the first failure, so a half-written database is
visible rather than summarised as success.

## Layering

Deciding what to write is a lower layer than writing it. `graph`, `resolve`, `walk` and `options`
never reach the writer or the runner, in either direction, and `layering.spec.ts` holds that line.

The `.` entrypoint never reads argv or writes stdout. That belongs to `./cli`, and both the lint
config and `module-boundary.spec.ts` enforce it.
