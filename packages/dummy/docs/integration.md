# Integration

## The seed script

`payload run` stops once the module finishes evaluating, so a floating promise never resumes. The
script has to be top-level `await`:

```ts
// src/seed.ts
import { runDummyCli } from "@abinnovision/payloadcms-dummy/cli";
import config from "@payload-config";
import { getPayload } from "payload";

import { seeds } from "./seeds";

await runDummyCli({
  payload: () => getPayload({ config }),
  seeds,
  naturalKeys: { articles: "slug", tags: "name" },
  resetCollections: ["pages", "articles", "posts", "sections", "tags"],
});
```

`payload` is a thunk so `--help` answers without connecting to a database.

The script itself needs a trailing `--`:

```json
{ "scripts": { "seed": "payload run src/seed.ts --" } }
```

Without it `payload run` keeps every flag for itself and the script sees an empty
`process.argv`, so `--fresh` and `--help` are silently ignored rather than refused.

`runDummyCli` destroys the instance it booted and never rejects, so the script needs no `try`. It
answers an exit code and sets `process.exitCode` rather than calling `process.exit`, because
`process.exit` can truncate output that has not flushed.

## Reset order

`resetCollections` is only used with `--fresh`, and is written in reverse dependency order so
nothing is deleted while another document still points at it. The delete passes `trash: true`, so
a fresh run also clears what an editor moved to the trash.

Leave out the collections that hold people rather than content. Clearing `users` on a re-run can
lock a developer out of `/admin`, and a seed has no business deleting sign-ups.

## Running without the CLI

`runDummySeeds` is the library call the CLI drives. Use it directly from app code, a test, or a
job:

```ts
import { runDummySeeds } from "@abinnovision/payloadcms-dummy";

const result = await runDummySeeds({ payload, seeds });

expect(result.writes.get("pages")).toMatchObject({ created: 2 });
```

It answers the per-collection tally, the units in the order they ran, how long the run took, and
how many documents the replay completed. It throws on the first failure, so a half-written run is
visible rather than reported as success.

Seeding from a test is the reason the library and the CLI are separate entrypoints. Importing
`@abinnovision/payloadcms-dummy` pulls in no argv reading and no stdout writing.

## Reporters

The library prints nothing. Pass a reporter to see a run:

```ts
import { createDummyConsoleReporter } from "@abinnovision/payloadcms-dummy";

await runDummySeeds({ payload, seeds, reporter: createDummyConsoleReporter() });
```

Every member of `DummyReporter` is optional, so routing a run into an existing logger means
implementing the two or three events that matter:

```ts
await runDummySeeds({
  payload,
  seeds,
  reporter: {
    wrote: ({ slug, key, action }) =>
      payload.logger.info(`${action} ${slug} ${key}`),
    warned: ({ message }) => payload.logger.warn(message),
  },
});
```

`wrote` fires per document, which is why the console reporter aggregates it into a tally rather
than printing a line each.

## Which flags to expose

`--fresh` is the one worth knowing. It replaces the seeded content instead of updating it, which
is what you want after changing a block's shape, and which a plain re-run deliberately does not do.

`--only <id>` runs one unit against whatever is already there. References fall back to the
database, so a unit can be iterated on without re-running the rest. It does not pull in
dependencies, which is the point and also the sharp edge: a unit whose dependency has never run
will report an unresolved reference.

## A non-empty database

This is a development and test tool. Pointing it at a database with real content in it will
upsert over any document whose natural key matches, which is rarely what anyone wants.

Two things make that less dangerous where a seed does have to touch a shared environment:

- `keepIfSet` on a global names a field that, once an editor has filled it in, means the seed
  leaves the global alone.
- `--fresh` is opt-in and only ever touches the collections named in `resetCollections`.

There is no dry run and no diff. If a seed must not overwrite something, do not declare it.

## Versions

Writes go through Payload's hooks and validation deliberately, so a seed cannot produce a
document the frontend is unable to render. On a collection with versions enabled that means each
run adds versions, the same way an editor saving twice would. A long-lived development database
accumulates them; `--fresh` clears them with the documents.
