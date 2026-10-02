# Standards

These rules apply to code in this package.

## Tests

Unit specs sit beside the source file they test and test one module through its exports.
Integration specs live in `test/integration`. They boot Payload on SQLite, in memory unless a test needs transactions, and go through
the MCP endpoint or the Local API.

A unit spec may build the fixture config but never boots Payload. A structural request stub, such
as a config and a logger, is fine. If the test needs a fake with behaviour, such as a database or
Payload operations, it belongs in integration. The one exception is `src/write/transaction.spec.ts`,
which uses a database fake because two of its branches, an adapter without transactions and an
outer transaction, cannot be reached through integration. `@payloadcms/ui` may be mocked in admin
specs.

A builder used by two specs moves to `test/builders`.

Assert what a caller can observe. Do not assert call counts, hook identity, CSS classes or
private fields. A log line is an outcome an operator sees, so a test may assert what a logger stub
received.

`describe` names the export or the tool. `it` states the behaviour in lowercase present tense:
`it("refuses a key whose user is locked out")`.

Use snapshots only for contracts that a machine or a model reads, such as tool lists and
descriptions.

Every test passes when run alone and in any order.

Every access rule has a test with two users, one allowed and one refused. Every test of a refusal
also asserts that nothing was written.

## Comments

A comment says why, or states a constraint the code cannot show. It describes the current code
only, never its history.

- `/** */` on exports, one to four lines.
- `/* */` for a block inside a function.
- `//` for a single line.

Longer rationale goes in `docs/`. Do not use em-dashes.

## Errors

- Return an error result (`errorResult`) for an outcome the client can act on, such as a stale
  `expectedUpdatedAt` or a pointer that does not resolve.
- Throw a public `APIError` for bad arguments and for authorisation failures.
- Throw `SchemaError` in schema code.

Anything else reaches the client as "Internal error" and is logged on the server.

## Model-facing text

Tool descriptions, parameter descriptions and the server instructions are read by a model that
picks a tool and its arguments from them. `test/integration/tools-list.spec.ts` locks them and
their length per tool.

- State each rule once. The server instructions hold the order of calls across tools, the
  difference between a schema path and a pointer, and drafts versus live writes. A tool repeats a
  rule only when leaving it out leads to a harmful call, such as the slugs whose writes go live.
- A description says what the tool does, when to use it, what it returns and what it refuses, in
  that order. A parameter description gives a format, a default or a constraint between fields.
- Do not restate the JSON Schema. Leave a parameter undescribed when its type, enum and bounds say
  everything.
- Give a reason only when it changes what the caller does.
- Use one term per concept: "schema path" for what `describeSchema` takes, "pointer" for a JSON
  Pointer into a document, "collection or global", and "rich text state".
- Every example path resolves on the fixture, which `description-examples.spec.ts` checks. Use no
  names from outside this repo.
- Write plain declarative sentences, without intensifiers, marketing words or em-dashes.
- A sentence that depends on the key's scope comes from one helper and is covered by a snapshot
  key.
