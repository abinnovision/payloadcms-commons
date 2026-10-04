# Concepts

The plugin gives an MCP client a fixed set of tools over a Payload content model. The client does
not receive the schema up front. It asks `describeSchema` for one node at a time, reads and
queries documents, and writes with RFC 6902 JSON Patch operations that the plugin resolves against
the config and the stored document. Adding a collection adds a slug to an enum; the tool list stays
the same.

## Tools

| Tool               | Arguments                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `listCapabilities` | none                                                                                                           |
| `describeSchema`   | `collection` or `global`, `paths?`, `expand?`                                                                  |
| `findDocuments`    | `collection`, `where?`, `sort?`, `limit?`, `page?`, `depth?`, `select?`, `locale?`, `draft?`                   |
| `getDocument`      | `collection` + `id` or `global`, `path?`, `depth?`, `locale?`, `draft?`, `outline?`, `versionId?`, `diffFrom?` |
| `findVersions`     | `collection` + `id` or `global`, `limit?`, `page?`, `status?`, `locale?`                                       |
| `patchDocument`    | `collection` + `id` or `global`, `locale`, `patches`, `expectedUpdatedAt?`, `file?`                            |
| `createDocument`   | `collection`, `locale`, `data`, `file?`                                                                        |
| `validateDocument` | `collection` + `id` or `global`, `locale?`                                                                     |
| `publishDocument`  | `collection` + `id` or `global`, `locale?`, `expectedUpdatedAt?`                                               |
| `deleteDocument`   | `collection`, `id`, `expectedUpdatedAt?`, `reason?`                                                            |
| `runConfirmed`     | `ids`                                                                                                          |

`locale` is only present when the config has localization. `depth` defaults to 0 and is capped
by `limits.maxDepth`; `limit` defaults to 10 and is capped by `limits.maxLimit`. `draft` defaults
to `true`, so reads return the latest draft.

`listCapabilities` is registered for every key, including one with nothing ticked. It returns the
collections and globals the key may read or write, whether a collection can also be created in
(`create`, which is `false` for an upload collection whose files MCP does not accept), draft and
version settings, the id type, the configured locales, the limits in force and the custom tools
the key may call. Collection and global descriptions from `admin.description` are included.

Every input schema is strict. An unknown argument is refused by name.

## Paths and pointers

Every path the plugin accepts or reports is a JSON Pointer. A schema path, as `describeSchema`
uses it, and a pointer into a document differ only in element positions: a schema path writes `*`
for an array element and names a block by its slug, where a document pointer uses a 0-based
index. The schema path `/items/*/heading` is written at `/items/0/heading`, and
`/layout/sections/sectionWrapper/identifier` at `/layout/sections/0/identifier`.

Rich text works differently, because an editor state is a tree rather than a list per type. A
schema path there names the node type, and for a block node its slug. A document pointer enters
the state at `root` and walks `children` by index, counting every child at that level, with the
node's own fields under `fields`. The schema path `/content/block/callout/tone` might be
written at `/content/root/children/3/fields/tone`; only the stored state says which index it
is. `getDocument` with `outline` answers that.

## Describing the schema

Called without `paths`, `describeSchema` describes the root of a collection or global. Pass schema
paths in `paths` to describe deeper nodes, or `expand: true` to get every node reachable from the
root in one response. `expand` stops after 400 nodes and says so.

- A blocks field stops at the block slugs it accepts. Each node carries `next`, the paths for
  those blocks (`/layout/sections/sectionWrapper`). Pass an entry of `next` in `paths` to descend.
  A block is described as it exists at that position, since the same block can accept different
  children elsewhere.
- Constraints travel with the field: `minRows` and `maxRows` on arrays and blocks fields,
  `minLength` and `maxLength` on text, `min` and `max` on numbers. An array is described as a
  node of its own, so the `*` in `/items/*/heading` has something to describe. A group or named tab
  is described only when it has a description or a constraint of its own.
- Field and collection `admin.description` values are included, so guidance written for editors
  reaches the client. A locale-keyed description resolves to the request's language, then the
  configured fallback language, then the first entry. Functions and components are dropped.
- Fields Payload maintains (`id`, `_status`, `createdAt`, `updatedAt`, `deletedAt`) are never
  listed and cannot be written. `readOnly` fields are listed and refused on write.
- Fields with `admin.hidden`, `hidden`, `admin.disabled` or `virtual`, and join fields, are not
  described and cannot be written. Read tools leave out `admin.hidden` fields too; see
  [security.md](./security.md#hidden-fields).

A path that does not resolve returns an error entry for that path. The other paths in the call
are still described.

## Patching

`patchDocument` applies operations to the current draft, in order.

- Nothing is written unless every operation validates first. A pointer that does not resolve is
  refused with the fields that are valid at that point.
- Adding a block needs `blockType` on the value. Append to a list with `/-` as the last segment.
- Clear a field with `replace` and `null`. An array or blocks field is emptied with `[]` and
  refuses `null`. `remove` works only on list elements, because Payload keeps a field that is
  missing from a write.
- Pass the `updatedAt` you read as `expectedUpdatedAt`. If the document changed since, the write
  is refused. The check is best effort; see [limitations.md](./limitations.md#known-gaps).

The response carries the document's `id` (or the global's slug), `status` and `updatedAt`, plus:

- `publishBlockers`: what still prevents publishing, each with a `path` pointer, a `message` and
  the `field` label. See [Drafts and publishing](#drafts-and-publishing).
- `notApplied`: pointers whose value did not change or cannot be read back by the user, as when
  field-level access denies the update. It is compared against the user's read; see
  [security.md](./security.md#privileged-reads).
- `publishBlockersUnavailable`: the blocker check failed, so an empty list says nothing.
- `adminUrl`: the document in the admin panel, opened in the written locale. It sits at the origin of
  `serverURL`, else of the MCP request.
- `previewUrl`: present when the entity sets `admin.preview` or a `livePreview` URL, in that order.
  The root `admin.livePreview` counts when it lists the slug. A relative URL is resolved against the
  same origin. A preview that throws or returns `null` is left out.

`createDocument` takes a seed in `data`, checked against the collection's fields before the
create. Unknown keys are refused with the valid alternatives, and a top-level `id` is refused. The
document may be incomplete; the response lists its publish blockers.

## Rich text

A `richText` field lists the Lexical node types it accepts in `nodes`. Its `next` carries a path
for every node type with fields of its own: `/content/link` for a link node,
`/content/block/callout` and `/content/inlineBlock/badge` for block nodes. Descending returns the
field list. `upload` nodes are not addressable, because their fields depend on the collection the
node points at.

A field also reports `nodeOptions`, the node properties its editor restricts. An editor built with
`HeadingFeature({ enabledHeadingSizes: ["h4"] })` reports `{ "heading": { "tag": ["h4"] } }`, and
a write with any other heading tag is refused. Lexical stores whatever tag it receives, so this is
the only place the restriction is checked.

A node must be written the way Lexical serializes it, with the values Lexical would write. Payload
does not check this on write, so the plugin does, and a refusal names the property and what
belongs there. A `describeSchema` response that includes a `richText` field ends with a
`nodeProperties` entry stating what each node type carries, in the same words a refusal uses. Its
`text` entry:

```json
{
  "detail": "a number",
  "format": "a number",
  "mode": "a string",
  "style": "a string",
  "text": "a string",
  "type": "a string",
  "version": "a number"
}
```

Pointers continue into the stored state, so a small edit does not rewrite the whole field.
`/content/root/children/2` is a node, `/content/root/children/2/tag` one of its properties, and
`/content/root/children/2/fields/url` a field it carries. The root and a node's `type` cannot be
replaced on their own, and a node property cannot be removed. A state whose root has no children
is refused, because Lexical reads it as empty and throws; clear the field with `null` instead.

Node positions shift when anything is added or removed, and text and paragraph nodes carry no id.
`getDocument` with `outline` returns one line per node with its pointer, its `version` and a text
excerpt. Read it right before patching, remove from the last index to the first, and put a `test`
operation on the node's `type` before writing to a position. `expectedUpdatedAt` still guards the
document as a whole.

## Globals

A global is exposed like a collection and uses the same tools:

```ts
mcpxPlugin({
  collections: { pages: { publish: false } },
  globals: { "site-settings": { publish: false } },
});
```

Pass exactly one of `collection` and `global`. `id` is required with `collection` and must be
left out with `global`. JSON Schema cannot express these rules, so the handler enforces them and a
refusal names the argument and the slug.
`findDocuments` and `createDocument` take collections only, since a global always exists.

A global's checkboxes live under `capabilities.globals.<name>`, apart from
`capabilities.collections.<name>`, so a global and a collection may share a name.

`expectedUpdatedAt` works as for collections, since Payload adds `updatedAt` to every global,
except on a global that has never been saved; see [limitations.md](./limitations.md#known-gaps).

## Upload collections

An upload collection may be exposed for write. `patchDocument` and `validateDocument` reach it,
and `publishDocument` does under the same `publish` rule as other collections, so a client
can edit the fields the collection declares, such as `alt` or a credit.

The base fields Payload adds (`filename`, `url`, `filesize`, `sizes`, the focal point) are neither
described nor writable.

Files go through MCP where the collection sets `upload.mimeTypes`. There, `createDocument` takes
the collection and requires `file`, and `patchDocument` takes `file` to replace the file of an
existing document, keeping its id, so every relation to it shows the new file. `file` is
`{ filename, mimeType, size }`. With it, `patches` may be empty.

A call with `file` writes nothing and returns an `upload`:

```json
{
  "upload": {
    "url": "https://cms.example.com/api/mcpx/upload",
    "method": "PUT",
    "headers": { "content-type": "image/png", "x-mcpx-grant": "<grant id>" },
    "expiresAt": "2026-01-01T12:05:00.000Z",
    "maxBytes": 26214400
  }
}
```

The client PUTs the file there, for example with
`curl -X PUT --data-binary @photo.png -H "content-type: image/png" -H "x-mcpx-grant: <grant id>" <url>`.
The PUT runs the call with the file and answers with its result. The patches and the file land as
one update and one version, and the draft guard decides where it lands as for any write: as a
draft where the collection has drafts, where publishing switches the file, and live otherwise.

`getDocument` with `download: true` reads a document of a readable upload collection as usual and
adds `download: { url, method: "GET", headers, expiresAt }`. The GET to that URL with those
headers returns the file, served by the collection's own `/file/:filename` endpoint as the key's
user, so it works where `access.read` is not public. It does not combine with `path`, `versionId`
or `diffFrom`.

An upload collection without `upload.mimeTypes` stays patch-only: `createDocument` leaves it out
of its `collection` enum and says why in its description. The requirements and refusals are in
[security.md](./security.md#uploads).

## Drafts and publishing

`write` and `publish` set how far MCP writes to an entity reach. Both default to `true`:

| `write` | `publish` | With `versions.drafts`                                  | Without                         |
| ------- | --------- | ------------------------------------------------------- | ------------------------------- |
| `false` | any       | no write tool reaches it                                | no write tool reaches it        |
| `true`  | `false`   | writes land as drafts, nothing is published             | refused at startup              |
| `true`  | `true`    | writes land as drafts, and `publishDocument` is exposed | writes change the live document |

Writing needs reading. `write: true`, `publish: true` or `delete` with `read: false` is refused at
startup, a `write` left at its default follows `read`, and a key's `write` counts only when its
`read` is ticked. A write-only key could not learn the schema or find an id, and what a patch
reports would reveal what it may not read.

`publish: true` on an entity without drafts, or with `write: false`, is refused at startup. So is
`publish: false` on an entity without drafts: every write there goes live, so set `write: false`
instead. Left at its default, `publish` is derived off. Without drafts there is no draft stage, so a write changes live
content; that is the only way an MCP write reaches live content apart from `publishDocument`.
Where it happens, the `patchDocument` and `createDocument` descriptions name those slugs for the
key in question, so a client is not told its writes are drafts when they are not.

A draft guard enforces this on the Payload operation rather than in the tools, so custom tools
that pass the MCP `req` are covered too. [security.md](./security.md#the-draft-guard) describes it
and lists what it does not cover.

`publishDocument` is the one way to publish. It publishes every locale, as the admin Publish
button does, and is refused when the document fails validation. Payload validates only the locale
the publish runs in, so a required field left empty in another locale goes live empty; see
[limitations.md](./limitations.md#known-gaps). After the publish, the result lists those fields as
`otherLocaleBlockers`, for information only. Publishing an unchanged document is accepted and
writes another version. There is no unpublish tool; reverting a published document to a draft is
done in the admin panel.

With `locale`, only that locale is published. The other locales of localized fields stay at their
last published state, while non-localized fields go live from the draft. A document that was never
published goes live in every locale regardless.

While someone has a collection document open in the admin panel, every MCP write to it is
refused, publishing included. Globals are not checked; see
[limitations.md](./limitations.md#known-gaps).

Payload skips validation on draft saves unless `versions.drafts.validate` is set. After every
write, the plugin runs Payload's field validation over the saved draft and returns the failures
as `publishBlockers`. The write stands, and the client gets a list of what remains. Where
`versions.drafts.validate` is set, Payload refuses an invalid draft and the failures come back as
`validationErrors`. Both use JSON Pointers.

The blocker check after a write validates only the written locale and runs the fields' hooks
again; see [limitations.md](./limitations.md#known-gaps). `validateDocument` runs the same check
without saving. With `locale` it checks that locale; without it, every configured locale, and each
blocker carries its `locale`. Because the hooks run, it carries no `readOnlyHint`.

## Deleting

`delete` is off by default and exists on collections only. Where a collection sets
`delete: true` and the key has the `read` and `delete` checkboxes, `deleteDocument` asks to delete one
document. It runs every check, deletes nothing and returns a `confirmation` with an `id`, a `url`
and `expiresAt`. The `url` opens the key's own edit view in the admin panel, where the key's user
approves or rejects the waiting calls, one by one or all at once. Approving runs nothing: the
client then passes the ids to `runConfirmed`, which answers each id in the order given with
`done` and the call's result, `pending`, `skipped` and a `reason`, or `refused`. A batch cleanup
is one `deleteDocument` call per document and one `runConfirmed` call for all of them.

On a collection with `trash: true` the document moves to trash, as the admin's own delete does.
Without trash it is deleted permanently, and an upload collection's file leaves storage. Set
`trash` on every collection exposed with `delete`. [security.md](./security.md#confirmations)
describes what is checked when.

`delete: "unattended"`, allowed only on a collection with `trash: true`, lets a key's Delete control
be set to Trash as well as Approval. Where a key is set to it, `deleteDocument`
runs the same checks and moves the document to trash at once, returning the delete result instead
of a confirmation. The client has no argument to choose this: the key decides. Every other key,
and every collection without it, still needs approval.

## Versions and diffs

Version history has no checkbox of its own. It follows the key's read on a collection or global
that has Payload `versions`, with or without drafts. `findVersions` lists the history newest first:
`versionId`, timestamps, `status`, `latest` and `autosave`, without bodies. It follows the `read`
capability. The document's `read` access is checked first, then Payload's `readVersions`, which
defaults to any logged-in user; see [security.md](./security.md#version-history).

A key that reaches no entity with Payload `versions` has no `findVersions`, and `getDocument` has no
`versionId` or `diffFrom`, so a call that passes them is rejected as an unknown argument. Once the
key reaches one such entity, those two arguments are refused for any other slug with
`"<slug>" does not expose version history.` `status` is only offered while the key reaches an
entity with drafts, since only drafts give a version a status. On an entity without drafts,
`findVersions` refuses it.

`getDocument` with `versionId` reads one of those versions instead of the document. `path`,
`outline`, `locale` and `depth` work as usual.

With `diffFrom`, which takes a version id or `"published"` (the newest version with published
status, in any locale), `getDocument` returns `{ from, to, patch }`: the RFC 6902 operations that
turn `diffFrom` into the document read, which is the current draft or `versionId` when given. The
operations use the pointers `patchDocument` takes, `path` limits them to a subtree, and `id`,
timestamps and `_status` are left out. Arrays are compared by position, so a reordered block
shows up as replace operations; see [limitations.md](./limitations.md#known-gaps).

There is no restore tool; [limitations.md](./limitations.md#not-included) says how to revert.
