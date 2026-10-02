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
| `patchDocument`    | `collection` + `id` or `global`, `locale`, `patches`, `expectedUpdatedAt?`                                     |
| `createDocument`   | `collection`, `locale`, `data`                                                                                 |
| `validateDocument` | `collection` + `id` or `global`, `locale`                                                                      |
| `publishDocument`  | `collection` + `id` or `global`, `expectedUpdatedAt?`                                                          |

`locale` is only present when the config has localization. `depth` defaults to 0 and is capped
by `limits.maxDepth`; `limit` defaults to 10 and is capped by `limits.maxLimit`. `draft` defaults
to `true`, so reads return the latest draft.

`listCapabilities` is registered for every key, including one with nothing ticked. It returns the
collections and globals the key may read or write, whether a collection can also be created in
(`create`, which is `false` for upload collections), draft and version settings, the id type, the
configured locales, the limits in force and the custom tools the key may call. Collection and
global descriptions from `admin.description` are included.

Every input schema is strict. An unknown argument is refused by name.

## Paths and pointers

Every path the plugin accepts or reports is a JSON Pointer. A schema path, as `describeSchema`
uses it, and a pointer into a document differ only in element positions: a schema path writes `*`
for an array element and names a block by its slug, where a document pointer uses a 0-based
index. The schema path `/items/*/title` is written at `/items/0/title`, and
`/layout/sections/hero` at `/layout/sections/0`.

Rich text works differently, because an editor state is a tree rather than a list per type. A
schema path there names the node type, and for a block node its slug. A document pointer enters
the state at `root` and walks `children` by index, counting every child at that level, with the
node's own fields under `fields`. The schema path `/content/block/callout/variant` might be
written at `/content/root/children/7/fields/variant`; only the stored state says which index it
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
  node of its own, so the `*` in `/items/*/title` has something to describe. A group or named tab
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

- `publishBlockers`: what still prevents publishing, each with a pointer, a message and the field
  label. See [Drafts and publishing](#drafts-and-publishing).
- `notApplied`: pointers whose value Payload kept unchanged, which happens when field-level access
  denies the update.
- `publishBlockersUnavailable`: the blocker check failed, so an empty list says nothing.

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
  collections: { pages: { read: true, write: "draft" } },
  globals: { "site-settings": { read: true, write: "draft" } },
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
and `publishDocument` does under the same `write: "live"` rule as other collections, so a client
can edit the fields the collection declares, such as `alt` or a credit.

The base fields Payload adds (`filename`, `url`, `filesize`, `sizes`, the focal point) are neither
described nor writable. `createDocument` leaves upload collections out of its `collection` enum
and says why in its description; see [limitations.md](./limitations.md#not-included).

## Drafts and publishing

`write` sets how far MCP writes to an entity reach:

| `write`   | With `versions.drafts`                                  | Without                                        |
| --------- | ------------------------------------------------------- | ---------------------------------------------- |
| `false`   | no write tool reaches it                                | no write tool reaches it                       |
| `"draft"` | writes land as drafts, nothing is published             | refused at startup: there is no draft to write |
| `"live"`  | writes land as drafts, and `publishDocument` is exposed | writes change the live document                |

`"live"` is the only setting that lets an MCP write reach live content. Where it is set, the server
instructions and the `patchDocument` and `createDocument` descriptions name those slugs for the
key in question, so a client is not told its writes are drafts when they are not.

A draft guard enforces this on the Payload operation rather than in the tools, so custom tools
that pass the MCP `req` are covered too. [security.md](./security.md#the-draft-guard) describes it
and lists what it does not cover.

`publishDocument` is the one way to publish. It publishes the whole document, as the admin
Publish button does, and is refused when the document fails validation. Payload validates only
the locale the publish runs in; see [limitations.md](./limitations.md#known-gaps). Publishing an unchanged document is accepted and writes another version. There is no
unpublish tool; reverting a published document to a draft is done in the admin panel.

While someone has a collection document open in the admin panel, every MCP write to it is
refused, publishing included. Globals are not checked; see
[limitations.md](./limitations.md#known-gaps).

Payload skips validation on draft saves unless `versions.drafts.validate` is set. After every
write, the plugin runs Payload's field validation over the saved draft and returns the failures
as `publishBlockers`. The write stands, and the client gets a list of what remains. Where
`versions.drafts.validate` is set, Payload refuses an invalid draft and the failures come back as
`validationErrors`. Both use JSON Pointers.

The blocker check validates only the written locale and runs the fields' hooks again; see
[limitations.md](./limitations.md#known-gaps). `validateDocument` runs the same check without
saving; because the hooks run, it carries no `readOnlyHint`.

## Versions and diffs

Version history is off by default. Set `versions: true` on a collection or global that has
Payload `versions`, with or without drafts. Then `findVersions` lists the history newest first:
`versionId`, timestamps, `status`, `latest` and `autosave`, without bodies. It follows the `read`
capability. The document's `read` access is checked first, then Payload's `readVersions`, which
defaults to any logged-in user; see [security.md](./security.md#version-history).

A key that reaches no entity with `versions: true` has no `findVersions`, and `getDocument` has no
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
