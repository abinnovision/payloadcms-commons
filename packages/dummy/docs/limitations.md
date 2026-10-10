# Limitations

## Not included

**No Payload plugin.** Seeding is a script, so there is nothing to add to `payload.config.ts` and
no endpoint, admin view or job. A seed that should run on a schedule belongs in whatever already
runs your jobs, calling `runDummySeeds`.

**No data generation.** No faker, no lorem, no random names. Demo content is the thing a reviewer
reads, so it is worth writing.

**No JSON or YAML seed files.** A unit is a TypeScript module, which types against your generated
types and can compute a value. A data file cannot.

**No transactions.** Each write commits on its own, so a run that fails halfway leaves what it
had already written. Because every write is an upsert, the fix is to run it again. What this
costs is atomicity: a half-seeded database is a real state, and a unit that fails after three of
its five documents leaves three behind.

**No remote uploads.** `ctx.upload` takes a local path. Fetching a URL would make a seed depend
on a service being up.

**No sync.** A document a unit stopped declaring is not deleted. `--fresh` is the answer, and it
only touches the collections you name.

**No dry run, no diff, no content hashing.** A run does not report what it would change, and does
not skip a document whose content is unchanged. Idempotence here means the upsert, nothing more.

**No schema-aware reference checking.** A reference is not verified to sit in a relationship field
pointing at that collection. Payload's own validation catches it with a better message than this
package could invent.

**No parallelism.** Units run one at a time even where the graph would allow otherwise. The
database is the bottleneck, and a deterministic order is worth more than the difference.

## Known gaps

**A required field cannot hold a forward reference.** Payload validates on the first write, and
nothing short of writing raw rows can satisfy a required relationship to a document that does not
exist. The error names the reference and the `dependsOn` that fixes it. Add the edge, or make the
field optional.

**A locale override's arrays must line up with the default locale's.** Where rows are shared
across locales, row ids are grafted by position, because the author supplies none. An override
with a different number of rows is refused rather than partly grafted. A genuinely different row
count per locale needs per-row natural keys, which Payload rows do not have; use `ctx.payload`
directly for that case.

**Rows that exist only in a non-default locale get no id.** They are written as new rows, which
is correct for an array that is itself `localized` and wrong for a shared one. The length rule
makes the wrong case an error rather than a silent loss.

**A localized natural key resolves in the default locale.** Keying a collection on a localized
field works, because the default locale is written first and the lookup runs there, but the key is
then only unique per locale as far as the database is concerned. Prefer a non-localized field.

**Uploads with rewritten filenames need a named key.** Payload rewrites `filename` on a collision,
and a collection that renames files in a hook rewrites it always. Dedup then fails and every run
creates another document. The run warns once per collection when it sees this; the fix is an
indexed text field holding the original name, named in `naturalKeys`.

**An upload's bytes are written outside any rollback.** Nothing undoes a file that landed before a
later failure. A re-run overwrites it.

**Each run adds versions.** Writes go through Payload's hooks and validation on purpose, so a
collection with versions enabled accumulates one set per run, as an editor saving twice would.

**No derived upload sizes are exercised.** The test fixture's upload collection declares no
`imageSizes`, so `sharp` is not a dependency of this package. Seeding a collection that does
declare them works, but it is your app's `sharp` doing the work and this package's tests do not
cover it.

**Generated types widen a hand-written Lexical state.** The generated type for a rich text field
describes the node union Lexical produces. A literal written by hand rarely satisfies it, so the
field usually needs a cast. References inside it are still typed.

**A reference is admitted at every leaf.** `DummyData` allows a reference wherever a value sits,
so a reference in a text field typechecks and fails at runtime instead. In the generated types a
relationship id and a text field are both `string`, so there is no type-level signal to
discriminate on.
