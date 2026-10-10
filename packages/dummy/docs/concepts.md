# Concepts

## A seed is a set of units, not a script

A unit is an `id`, an optional `dependsOn`, and a `run`. The runner sorts the units and calls
each one once. Nothing in a unit knows where it sits in the order.

That matters because the alternative, a single script of `payload.create` calls, ties three
things together that change at different rates: what content exists, what order it is written
in, and which document holds which id. A unit owns the first. The runner owns the second. The
natural key owns the third.

## Natural keys make a re-run safe

Every write is an upsert: find a document whose key field equals the value in the data, update it
if it is there, create it if it is not. So a second run leaves the same documents with the same
ids, and a changed field lands without a duplicate appearing next to the old one.

The key is derived from the single unique field a collection declares. A collection with no
unique field, or with several, has to name one through `naturalKeys`, and does so the first time
a unit writes to it rather than at startup. An ambiguous key is refused rather than guessed,
because the wrong key silently upserts the wrong document, which is worse than a failed run.

An upload is keyed on the file's basename. Payload rewrites `filename` only on a collision, so
this needs no configuration for a stock upload collection; a collection that renames files in a
hook names its own indexed field instead, and is warned if it does not.

## What is read from the config rather than configured

A seed should not restate what `payload.config.ts` already says, because the two drift and the
seed is the copy nobody checks. So:

- whether a collection or global has drafts, and therefore whether a write needs `_status`
- whether a collection takes a file, and therefore whether it can be handed a path
- which field identifies a document, where the collection declares a unique one

are all read off the sanitized config. A draft-enabled collection is published without the call
site asking, and a collection with versions but no drafts is written live with no `draft` flag at
all.

The reset order is the exception. It cannot be derived from the unit graph, because units are not
collections, and deriving it from relationship fields is more machinery than naming six slugs.

## References, and why they are data

`ctx.ref("sections", "journal")` is a plain object: a brand, a collection and a key. It is not a
promise, not a thunk, and not a function call that has to happen in the right order. It sits in a
literal exactly where the id goes.

The writer walks the data before handing it to Payload and substitutes every reference it can
resolve, from the keys this run has written and then from the database. The walk is structural,
so a reference resolves wherever it sits: a top-level relationship, a `hasMany` array, a
polymorphic `{ relationTo, value }`, a field inside a blocks row, the `reference` of a Lexical
link node.

The database fallback is what makes `--only` useful: one unit can be re-run against an already
seeded database and still resolve everything it points at. Only successful lookups are
remembered, because a key missing now may be written by a later unit.

## The replay pass

`dependsOn` expresses ordering. References express data. The two are separate on purpose, because
content genuinely contains cycles (a menu links to pages, and every page renders the menu) and a
graph cannot.

So a reference pointing at a document that does not exist yet is not an error. The writer prunes
the field, records the call, and the runner replays it in full once every unit has finished. The
prunable unit is the nearest enclosing array element, or the top-level field; a rich text state
is treated as one value, so a single unresolved link never leaves a paragraph without its text.

The whole call is replayed rather than the one field patched. Payload replaces arrays wholesale,
so patching a reference nested inside a blocks row would mean rebuilding its parent array anyway,
and the write is an idempotent upsert, so writing it twice reaches the same place.

**One pass is always enough.** Every replayed call is for a document that already exists, and a
prune never removes the natural key, so by the end of the unit loop every key any reference could
name is known. There is no loop, no progress detection and no iteration limit. A reference still
unresolved after the replay is genuinely unsatisfiable, and is reported with the keys that exist.

The one case this cannot help with is a `required` field. Nothing short of writing raw rows can
satisfy a required relationship to a document that does not exist, so Payload refuses the first
write and the error names the reference and the `dependsOn` that would fix it.

## Localized writes and shared rows

Payload stores a localized field per locale, but an array's **rows** are shared unless the array
itself is localized. That distinction is the whole difficulty.

Where rows are shared and a field inside them is localized, a write that arrives without the
stored row ids looks to Payload like a new set of rows. It replaces them, and the other locales'
values go with the rows they were attached to. So the writer reads the document back at the
locale it is about to write, grafts the stored ids onto the override by position, and then writes.

Position is the only correspondence available, because the author supplies no ids. That makes
equal length a requirement rather than a preference, and a mismatch is refused with the path. The
alternative, grafting as far as the shorter array goes, is exactly how a locale gets lost.

An array that is itself `localized` has its own rows per locale with their own ids. The read is
made with the fallback disabled, so such an array answers nothing on a first write and its own
rows afterwards, and no id is ever carried across a locale boundary.
