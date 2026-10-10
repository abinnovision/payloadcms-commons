# @abinnovision/payloadcms-dummy

![A bound mock-up of a site, its placeholder pages filled in and cross-referenced](https://raw.githubusercontent.com/abinnovision/payloadcms-commons/main/packages/dummy/assets/header.png)

Declarative, idempotent seeding for [Payload CMS](https://payloadcms.com/).

A dummy, in printing and publishing, is the mock-up a printer binds before the real run:
placeholder pages at the right size and bulk, made to be checked and thrown away. This writes
that into a Payload database, so a development environment has a site to click through and a
test has content to read.

A seed is a set of units with declared dependencies. The runner orders them, and every write is
an upsert on a natural key, so running it twice changes nothing. Documents reference each other
by that key rather than by id, which means a seed file never threads ids through local variables
and never has to care which unit runs first.

## Install

```sh
yarn add --dev @abinnovision/payloadcms-dummy
```

| Peer      | Range         | Needed for |
| --------- | ------------- | ---------- |
| `payload` | `>=3.88.0 <4` | everything |

ESM only, like Payload itself. There is no plugin to add to `payload.config.ts`: seeding is a
script, not configuration.

## Setup

Declare the units, then run them from a script:

```ts
// src/seeds/index.ts
import { defineDummySeed } from "@abinnovision/payloadcms-dummy";

export const seeds = [
  defineDummySeed({
    id: "sections",
    run: async (ctx) => {
      await ctx.doc("sections", { slug: "journal", title: "Journal" });
    },
  }),
  defineDummySeed({
    id: "articles",
    dependsOn: ["sections"],
    run: async (ctx) => {
      await ctx.doc("articles", {
        slug: "hello-world",
        title: "Hello world",
        section: ctx.ref("sections", "journal"),
      });
    },
  }),
];
```

```ts
// src/seed.ts
import { runDummyCli } from "@abinnovision/payloadcms-dummy/cli";
import config from "@payload-config";
import { getPayload } from "payload";

import { seeds } from "./seeds";

/*
 * Top-level await, not a `main()` call: `payload run` stops once the module
 * finishes evaluating, so a floating promise never resumes.
 */
await runDummyCli({
  payload: () => getPayload({ config }),
  seeds,
  resetCollections: ["articles", "sections"],
});
```

```json
{ "scripts": { "seed": "payload run src/seed.ts --" } }
```

The trailing `--` is load-bearing: without it `payload run` keeps the flags for itself and the
script sees an empty `process.argv`, so `--fresh` would silently do nothing.

`yarn seed` fills an empty database and leaves a seeded one untouched.

## Seed units

A unit has an `id`, optional `dependsOn`, and a `run` that writes through the context it is
given. `dependsOn` orders the run and nothing else; a reference does not need an edge.

The context writes four ways:

| Call                                  | Does                                                            |
| ------------------------------------- | --------------------------------------------------------------- |
| `ctx.doc(collection, data, options?)` | Upserts a document by its natural key and answers its id.       |
| `ctx.upload(collection, path, data?)` | Uploads a local file, reusing the document for that basename.   |
| `ctx.global(slug, data, options?)`    | Overwrites a global, unless `keepIfSet` says an editor owns it. |
| `ctx.lookup(collection, key)`         | The id of a document already written, or `undefined`.           |

`ctx.payload` is there for anything these do not cover.

## Natural keys

A document is identified across runs by one field. Where a collection declares a single unique
field, that is the key and nothing has to be configured. Where it declares none or several, name
one:

```ts
await runDummySeeds({
  payload,
  seeds,
  naturalKeys: { articles: "slug", tags: "name" },
});
```

An ambiguous collection fails the first time a seed writes to it, naming the candidates. A guess
would be worse: the wrong key upserts the wrong document.

Drafts, uploads and locales are read off the sanitized config rather than restated here, so a
draft-enabled collection is published without the call site asking and a collection with
versions but no drafts is written live.

## References

`ctx.ref` names a document by its natural key and resolves to its id, which is the shape of a
single relationship, a `hasMany` entry and an upload field. `ctx.polyRef` resolves to
`{ relationTo, value }`, which is what a polymorphic relationship and a rich text link node take.

A reference works at any depth: inside an array, inside a blocks row, inside a Lexical link node.
The `./lexical` entry builds Lexical states with refs in them, see
[`docs/recipes.md`](./docs/recipes.md#a-reference-inside-a-lexical-state).

A reference that points at a document written by a **later** unit is not an error. The field is
left out of the first write, and the whole call is replayed once every unit has finished, so two
collections can reference each other without either knowing:

```ts
defineDummySeed({
  id: "authors",
  run: async (ctx) => {
    // Written by the "books" unit, which runs after this one.
    await ctx.doc("authors", {
      name: "Ada",
      featuredBook: ctx.ref("books", "Notes"),
    });
  },
});
```

One replay pass is always enough, so there is no loop and no iteration limit. A reference that
still does not resolve is reported with the keys that do exist.

A `required` field is the exception: Payload refuses the first write, and the error says which
reference caused it and which `dependsOn` would fix it.

## Localization

Extra locales are written in the same call:

```ts
await ctx.doc(
  "posts",
  { title: "The first post" },
  { locales: { de: { title: "Der erste Beitrag" } } },
);
```

The default locale is written first, then one update per extra locale. Where an array's rows
carry a localized field, the rows are shared across locales, and a write without the stored row
ids would drop the other locales' values. The writer reads the ids back and grafts them on, so
the override is just data.

That makes one rule a requirement: an array in an override must have the same length and order
as the default locale's. A mismatch is refused with the path rather than silently losing a locale.
An array that is itself `localized` has its own rows per locale and is left alone.

## Order

Units are sorted by `dependsOn` in declaration order, so the run is reproducible. A duplicate id,
an unknown dependency and a cycle are all refused before the first write, and the cycle error
names a path through it:

```
[payloadcms-dummy] Seed dependency cycle: chrome -> pages -> chrome.
Remove one dependsOn. A ref that points at a seed running later does not need
an edge; it is written on the replay pass instead.
```

## Options

| Option             | Default | Description                                                              |
| ------------------ | ------- | ------------------------------------------------------------------------ |
| `payload`          | none    | The initialised instance. A thunk, on the CLI.                           |
| `seeds`            | none    | The declared units, in any order.                                        |
| `naturalKeys`      | derived | Overrides the key derived from a collection's unique field.              |
| `resetCollections` | `[]`    | Emptied before the first unit when `fresh`, in reverse dependency order. |
| `fresh`            | `false` | Delete `resetCollections` first.                                         |
| `only`             | all     | Run only these units, without pulling in their dependencies.             |
| `reporter`         | silent  | Receives progress. The library prints nothing without one.               |

## CLI

| Flag          | Effect                                    |
| ------------- | ----------------------------------------- |
| `--fresh`     | Delete `resetCollections` before seeding. |
| `--only <id>` | Run only this unit. Repeatable.           |
| `--quiet`     | The tally and the warnings only.          |
| `--help`      | The flags and the declared unit ids.      |

`runDummyCli` never rejects. It answers an exit code and sets `process.exitCode`, so a failed
seed stops a CI step without truncating its own output.

## Entrypoints

    @abinnovision/payloadcms-dummy        defineDummySeed, runDummySeeds, the refs, the reporter
    @abinnovision/payloadcms-dummy/cli    runDummyCli, which reads argv and writes stdout

The split is the point: the library can be called from app code and from a test without
dragging argv and stdout in with it.

## Documentation

- [`docs/concepts.md`](./docs/concepts.md): natural keys, the unit graph, how a reference
  resolves, and the replay pass.
- [`docs/integration.md`](./docs/integration.md): the seed script, reset order, reporters, and
  seeding from a test.
- [`docs/recipes.md`](./docs/recipes.md): mutual references, blocks, Lexical states, uploads,
  globals an editor owns, localized sites.
- [`docs/limitations.md`](./docs/limitations.md): what this does not do, and what to do instead.
- [`docs/standards.md`](./docs/standards.md): the rules code in this package follows.

## License

Apache-2.0
