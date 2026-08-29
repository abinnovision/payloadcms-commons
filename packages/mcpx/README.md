# @abinnovision/payloadcms-mcpx

A Payload CMS plugin that mounts an MCP (Model Context Protocol) server whose
tool surface stays small and accurate regardless of the size of the
content model.

Instead of generating one tool per collection with the full document schema
inlined, the plugin types its surface in three layers. The tool signatures are
small and static: collection slugs, locales and operations as enums, everything
else scalars. The field shapes are pulled on demand through `describeSchema`,
one node at a time, stopping at every blocks boundary. And every write is
resolved server-side against the real config and the real document, so unknown
fields, misplaced blocks and unusable rich text nodes or node fields are refused with the
valid alternatives listed, never silently dropped.

Writes are RFC 6902 patches that land as drafts. One config axis decides how far
they reach: `write: "draft"` never changes live content, `write: "live"` does —
by exposing `publishDocument` where versions exist, and by permitting the write
at all where they do not. Every write returns the publish blockers: the
validation failures that still prevent the draft from being published.
Capabilities are declared twice: the plugin config decides what can exist, a
checkbox on each API key decides what does, and a missing checkbox means no
(fail-closed).

## Install

```bash
yarn add @abinnovision/payloadcms-mcpx
```

- Peer dependency: `payload >=3.88.0 <4`.
- `@payloadcms/ui` and `react` are optional peers, needed only by the admin
  setup guide. A headless install can leave them out and set
  `apiKeys.setupGuide: false`.
- The package is published as ESM only, matching Payload itself.

## Usage

```ts
import { mcpxPlugin } from "@abinnovision/payloadcms-mcpx";
import { buildConfig } from "payload";

export default buildConfig({
  // ...
  plugins: [
    mcpxPlugin({
      collections: {
        pages: { read: true, write: "live" }, // may be published through MCP
        posts: { read: true, write: "draft" }, // drafts only
        tags: true, // shorthand for { read: true }
      },
      globals: {
        "site-settings": { read: true, write: "draft" },
      },
      limits: { maxLimit: 25, maxDepth: 1 },
    }),
  ],
});
```

The plugin adds:

- a `POST /api/mcpx` endpoint speaking MCP over streamable HTTP (stateless,
  JSON responses; `GET`/`DELETE` answer 405),
- an `mcpx-api-keys` collection (admin group "MCP") holding the keys and their
  capability checkboxes,
- a draft guard on every collection and global, so any write carrying the MCP
  request marker lands as a draft, including writes made by custom tools.

## API keys

Keys are created in the admin panel under MCP > API Keys. The plaintext key is
generated on create, stored encrypted with an HMAC index for lookup, and shown
to anyone who may read the key document (own keys only, by default). Each key:

- is bound to the user who created it and acts as that user: every operation
  runs with `req.user` set to the linked user and `overrideAccess: false`, so
  your collection access control applies unchanged;
- carries one checkbox per exposed collection and operation, plus one per
  custom tool. All checkboxes default to off. A key can never enable an
  operation the plugin config does not expose, and keys created before a
  capability existed stay without it. The `publish` checkbox only exists where
  a versioned entity is configured `write: "live"`, so a key issued before
  publishing was possible stays closed to it, and it counts only alongside
  `write`: publishing is an extension of writing, not a capability of its own.

Keys authenticate only the MCP endpoint. They are deliberately not a Payload
auth strategy, so a key can never authenticate the REST or GraphQL API; the
reverse also holds: an admin session or JWT is ignored by the MCP endpoint.

Use `apiKeys.overrideCollection` to widen access (for example, admins manage
all keys) or add fields.

## Connecting a client

Saved keys carry a **Connect a client** tab in the admin holding these same
instructions with their own URL and key filled in, each block behind a copy
button. The tab only exists once the key does, so the create form stays free of
it. Turn it off with `apiKeys.setupGuide: false`, which also drops the tabs and
restores the flat form.

The tab renders an admin component, so it has to be in the import map:

```bash
payload generate:importmap
```

Without that entry Payload logs a missing-component error and renders nothing
else; the rest of the plugin is unaffected. The URL comes from `serverURL` when
the config sets one and from the browser's origin otherwise.

The endpoint speaks streamable HTTP with `Authorization: Bearer <key>`:

```bash
npx @modelcontextprotocol/inspector
# transport: Streamable HTTP, URL: http://localhost:3000/api/mcpx
# header: Authorization: Bearer <key>
```

Claude Code:

```bash
claude mcp add --transport http payload http://localhost:3000/api/mcpx \
	--header "Authorization: Bearer <key>"
```

Claude Desktop (no direct HTTP header support) via `mcp-remote`:

```json
{
  "mcpServers": {
    "payload": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:3000/api/mcpx",
        "--header",
        "Authorization: Bearer <key>"
      ]
    }
  }
}
```

## Tools

The surface is fixed at eight tools plus your custom ones; exposing a global
adds an argument, never a tool. `tools/list` reflects the key: write tools
disappear for read-only keys, and every `collection` and `global` enum contains
only the slugs the key may touch.

| Tool               | Purpose                                                     | Key arguments                                                                                |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `listCapabilities` | What this key may do; call first to orient.                 | none                                                                                         |
| `describeSchema`   | Field shape of one node; `next` lists the drill-down paths. | `collection` \| `global`, `paths?`, `expand?`                                                |
| `findDocuments`    | Query documents.                                            | `collection`, `where?`, `sort?`, `limit?`, `page?`, `depth?`, `select?`, `locale?`, `draft?` |
| `getDocument`      | Read one document or a subtree of it.                       | `collection` + `id` \| `global`, `path?` (JSON pointer), `depth?`, `locale?`, `draft?`       |
| `patchDocument`    | Apply RFC 6902 operations to the current draft.             | `collection` + `id` \| `global`, `locale`, `patches`, `expectedUpdatedAt?`                   |
| `createDocument`   | Create a draft from a minimal seed.                         | `collection`, `locale`, `data`                                                               |
| `validateDocument` | Publish blockers without saving anything.                   | `collection` + `id` \| `global`, `locale`                                                    |
| `publishDocument`  | Publish the current draft.                                  | `collection` + `id` \| `global`, `expectedUpdatedAt?`                                        |

Rules the tools enforce and explain in their own descriptions:

- `describeSchema` paths stop at blocks fields, which list the block slugs they
  accept; every node carries `next`, the ready-to-use paths for those blocks
  (`/layout/sections/sectionWrapper`), so pass an entry of `next` as a `paths`
  element to descend. A block is described as it exists at that position.
- Rich text paths continue the same way. A `richText` field lists the Lexical
  node types it accepts in `nodes`, and `next` carries a path for every node
  type that holds fields of its own: `/content/link` for a link node,
  `/content/block/callout` and `/content/inlineBlock/badge` for the block
  nodes. Descending returns the real field list, so a link extended through
  `LinkFeature({ fields })` and a Lexical block are both described rather than
  guessed. Any feature declaring `getSubFields` is picked up, custom ones
  included. `upload` nodes are the exception: their fields depend on the
  collection the node points at, so they are not addressable.
- Constraints a field declares travel with it: `minRows`/`maxRows` on arrays
  and blocks fields, `maxLength`/`minLength` on text, `min`/`max` on numbers.
  An array is described in its own right, so the `*` in `/items/*/title` has
  something to read; a group or named tab only when it declares a description
  or a constraint of its own.
- A `richText` field also reports `nodeOptions`, the node properties its editor
  narrows. An editor built with `HeadingFeature({ enabledHeadingSizes: ["h4"] })`
  answers `{ "heading": { "tag": ["h4"] } }`, and a write carrying any other
  heading tag is refused. Lexical stores whatever tag it is given, so this is
  the only place the restriction is checked.
- Field and collection `admin.description` values are included in
  `describeSchema` and `listCapabilities`, so intent written for the admin
  panel reaches the client. A locale-keyed record is resolved to one string for
  the request's language, falling back to the deployment's fallback language and
  then to the record's first entry; functions and components are dropped.
- Builtin tools reject unknown arguments by name instead of silently ignoring
  them.
- Every path this plugin accepts or reports is a JSON Pointer. A schema path
  and a pointer into a document differ only in what stands in an element
  position: a schema path writes `*` for an array element and names a block by
  its slug, where a pointer carries a 0-based index. So `/items/*/title` is
  written at `/items/0/title`, and `/layout/sections/hero` at
  `/layout/sections/0`.
- Adding a block requires `blockType` on the value; append with `/-`.
- Clearing is `replace` with `null`; a list is emptied with `[]` and refuses
  `null`. `remove` is only valid on list elements, because Payload keeps
  fields absent from a write.
- Nothing in a patch batch is applied unless every operation validates first.
- Pass the `updatedAt` you read as `expectedUpdatedAt` so a concurrent edit is
  refused instead of overwritten.
- Fields Payload maintains (`id`, `_status`, `createdAt`, `updatedAt`,
  `deletedAt`) are never listed and never writable; `readOnly` fields are
  listed but refused on write.

## Globals

A global is exposed the same way a collection is, and reached through the same
tools rather than tools of its own:

```ts
mcpxPlugin({
  collections: { pages: { read: true, write: true } },
  globals: { "site-settings": { read: true, write: true } },
});
```

Two rules follow from a global being a singleton, and because JSON Schema cannot
state either one, both are enforced in the handler and repeated in every
affected tool description:

- Pass exactly **one** of `collection` and `global`.
- `id` is required with `collection` and must be omitted with `global`.

Refusals name the offending argument and the slug, so one failed call teaches
the rule. `findDocuments` and `createDocument` stay collection-only: there is
nothing to list and nothing to create when the document always exists. They
reject a `global` argument by name.

Globals get their own `capabilities.globals.<name>` checkbox group, a separate
namespace from `capabilities.collections.<name>`, so a global may share a
camelCase name with a collection. Keys issued before a global was exposed have
no such group, and an absent checkbox reads as `false`, so they stay closed to
every global until one is ticked.

Globals always carry `updatedAt` — Payload appends it and there is no
`timestamps: false` for globals — so `expectedUpdatedAt` behaves as it does for
collections. The one exception is a global that has never been saved: it has no
`updatedAt` to compare against, so the first write must omit
`expectedUpdatedAt`, and supplying one is refused as a concurrency failure.

If `tools/list` omits `global` entirely, no global is exposed to that key; the
argument only appears once one is. A deployment that uses no globals sees the
tool schemas exactly as they were.

## Drafts and publishing

Draft-only writing is enforced on the Payload operation, not in the tool
handlers: a `beforeOperation` hook forces `draft: true` and strips `_status`
from every write carrying the MCP request marker, so custom tools and anything
else writing through the same request are covered too. A `beforeChange` hook
refuses any write that would still not land as a draft.

The two hooks are not equally load-bearing on both sides. `updateGlobal` reads
`draft` and the publish arguments off its argument bag _before_ it runs
`beforeOperation`, and re-reads only `data` afterwards, so for a global the
correction cannot apply and the `beforeChange` refusal is what actually holds
the line. Both are installed on every collection and global, exposed or not.

`publishDocument` is the one way through, and it opens the door for exactly one
write: the tool marks that write's own `data` object, and the guard grants the
publish only to a write carrying the mark. Nothing is scoped to a slug or an id
because nothing else can reach it — a concurrent call in the same JSON-RPC batch
has its own `data`, and so does a nested write from a hook during the publish.
That matters: the endpoint hands one `PayloadRequest` to every tool, and the
transport dispatches the messages of a batch without awaiting each one, so an
intent kept on the request would be reachable by a sibling `patchDocument` and
would publish it. The mark is a string key holding a token minted per process,
because Payload's copy of the write data keeps string keys and drops symbols,
and a token cannot be forged by a client writing a field of the same name. It is
still not a security boundary — a custom tool holds the whole `payload` instance
— but no ordinary write can widen itself into a publish.

Publishing covers the whole document, as the admin Publish button does, but
Payload only validates the locale the publish runs in. A required field left
empty in another locale therefore goes live empty; that is Payload's behaviour,
not something this plugin adds. `publishDocument` refuses a document that fails
validation and reports `validationErrors` with JSON Pointers. It is refused
while a human holds the document open in the admin panel, and republishing an
unchanged document is accepted but writes another version.

There is no unpublish tool. Reverting a published document to a draft stays a
human action.

Publish blockers are advisory. Payload skips validation on draft saves (unless
`versions.drafts.validate` is set), so after every write the plugin re-runs
Payload's own field validation over the saved draft and returns the failures
as `publishBlockers` with paths and labels. The write stands; the client gets a
checklist of what remains. Three limits: only the written locale is
validated; field `beforeChange` hooks run again during the check, so they must
be pure; and the check runs privileged, so blocker paths and messages may name
fields the key's user cannot read (values are never included).
Collections with `versions.drafts.validate: true` refuse invalid drafts
outright; those failures come back as `validationErrors`. Both carry pointers,
restated from the dotted paths Payload reports internally.

`publishBlockersUnavailable` marks a check that could not complete, which is
not the same answer as a document with nothing wrong with it. `validateDocument`
runs the same traversal without saving anything, so it is not free of side
effects: field `beforeValidate` and `beforeChange` hooks run, and it carries no
`readOnlyHint` for that reason.

Writes also report `notApplied`: pointers whose value Payload kept unchanged,
which happens when field-level access denies the update.

## Custom tools

```ts
import { defineMcpxTool } from "@abinnovision/payloadcms-mcpx";
import { z } from "zod";

const publishQueue = defineMcpxTool({
  name: "queueForReview",
  description: "Marks a page as ready for editorial review.",
  inputSchema: { id: z.string() },
  handler: async ({ args, req }) => {
    // req.user is the key's linked user, req.context.mcpx carries the
    // key id and capabilities. Writes through payload.update({ req })
    // land as drafts like every other MCP write.
    await req.payload.update({
      collection: "pages",
      id: args.id,
      data: { reviewRequested: true },
      overrideAccess: false,
      req,
    });
    return { content: [{ type: "text", text: "queued" }] };
  },
});
```

Each custom tool gets its own checkbox on every API key, default off.

Custom tools take the same route as the builtins: one `McpxTool` shape, one
registration loop. Anything a builtin does, a custom tool can do.

`handler` receives `scope` alongside `args`, `req` and `extra`. The scope
carries what the key may touch (`readable`, `writable`, `publishable`,
`readableGlobals`, `writableGlobals`, `publishableGlobals`), the configured
locales, the limits in force and the exposed collections and globals. `req` is shorthand for `scope.req`.

`inputSchema` may be a function of that scope instead of a fixed shape, which
is how a tool narrows an enum to what the key may read:

```ts
import { defineMcpxTool } from "@abinnovision/payloadcms-mcpx";
import { z } from "zod";

const whichCollection = defineMcpxTool({
  name: "whichCollection",
  description: "Echoes back one of the collections this key may read.",
  isEnabled: (scope) =>
    scope.capabilities.tools["whichCollection"] === true &&
    scope.readable.length > 0,
  inputSchema: (scope) => ({
    collection: z.enum(scope.readable as [string, ...string[]]),
  }),
  handler: ({ args }) => ({
    content: [{ type: "text", text: args.collection }],
  }),
});
```

`defineMcpxTool` defines every tool, builtin ones included, and infers the
handler's arguments from the input schema either way: from a fixed shape, or
from the object literal a per-request shape returns. Above, `args` is
`{ collection: string }` without being told.

Inference reaches as far as the shape's static type. A helper returning
`z.ZodRawShape` erases that type and leaves `args` as
`Record<string, unknown>`, so the builtins' shape helpers declare the superset
they produce instead: which keys a helper emits depends on the key's scope,
and the declared type states what a handler must cope with across every scope.
Their arguments stay derived from their schema that way, and cannot drift from
it. If your own helpers erase, state the arguments as a type argument:
`defineMcpxTool<Args>({ ... })`.

`isEnabled` decides whether the tool is registered for this key at all: a tool
that is not enabled never appears in `tools/list`. It defaults to the tool's
own checkbox, which is what the builtins replace to derive their availability
from the key's collection and global capabilities. Defining it **replaces**
the checkbox check, so restate `scope.capabilities.tools[name]` when you still
want it, as above.

Every input schema is registered strictly, custom tools included: an unknown
argument is rejected by name rather than stripped before the handler runs.

`jsonResult` and `errorResult` are exported so a custom tool can return
results shaped like a builtin's.

## Options

| Option                       | Default                        | Description                                                       |
| ---------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `collections`                | required                       | Allow-list. `true` means `{ read: true }`.                        |
| `collections.<slug>.read`    | `true`                         | Expose `describeSchema`, `findDocuments`, `getDocument`.          |
| `collections.<slug>.write`   | `false`                        | `"draft"` or `"live"`. See below.                                 |
| `globals`                    | `{}`                           | Allow-list of globals. `true` means `{ read: true }`.             |
| `globals.<slug>.read`        | `true`                         | Expose `describeSchema`, `getDocument`.                           |
| `globals.<slug>.write`       | `false`                        | `"draft"` or `"live"`. See below.                                 |
| `userCollection`             | `config.admin.user` or `users` | Auth collection the keys act as.                                  |
| `apiKeys.slug`               | `mcpx-api-keys`                | Slug of the generated key collection.                             |
| `apiKeys.setupGuide`         | `true`                         | Add a "Connect a client" tab to saved keys. Needs the import map. |
| `apiKeys.overrideCollection` | none                           | Final override applied to the generated collection.               |
| `endpoint.path`              | `/mcpx`                        | Endpoint path below the API route.                                |
| `limits.maxLimit`            | `25`                           | Upper bound for `findDocuments.limit`.                            |
| `limits.maxDepth`            | `1`                            | Upper bound for `depth` on reads.                                 |
| `tools`                      | `[]`                           | Custom tools, defined the same way as the builtins.               |
| `auth.resolve`               | none                           | Replace or wrap the default key resolution.                       |
| `serverInfo`                 | package name and version       | Reported to MCP clients.                                          |

`write` is one axis: how far MCP writes to this entity reach.

| `write`   | With `versions.drafts`                                  | Without                                        |
| --------- | ------------------------------------------------------- | ---------------------------------------------- |
| `false`   | no write tool reaches it                                | no write tool reaches it                       |
| `"draft"` | writes land as drafts, nothing is ever published        | refused at startup: there is no draft to write |
| `"live"`  | writes land as drafts, and `publishDocument` is exposed | writes land on the live document               |

`"live"` is the only way an MCP write reaches live content, whichever of the two
shapes it takes. Wherever it is set, the server instructions and the
`patchDocument` and `createDocument` descriptions name those slugs for the key in
question, so a client is never told its writes are drafts while they are not,
nor that publishing is out of reach when it is not.

Migrating from the previous option shape: `write: true` becomes
`write: "draft"`, and `write: true` with `allowLiveWrites: true` becomes
`write: "live"`. A versioned entity moved to `write: "live"` gains a `publish`
checkbox on every key, unticked, so nothing publishes until someone says so.

Misconfiguration (unknown slugs, `write: "draft"` on a collection without
drafts, upload collections exposed for write, tool name collisions) fails at
startup with `InvalidConfiguration`. So does `write: "live"` on an entity using
`versions.drafts.localizeStatus`, which is not supported yet. Auth collections cannot be exposed at all, read
included: their documents carry credentials, such as the decrypted Payload API
key of every user.

## Security notes

- Keys are stored encrypted; lookup is by HMAC-SHA256 index derived from
  `payload.secret`, the same scheme Payload uses for its own API keys.
- The endpoint authenticates with Bearer keys only; admin JWTs and cookies are
  ignored. Keys cannot authenticate REST or GraphQL.
- Every operation runs under the linked user with `overrideAccess: false`.
- Payload has no separate publish permission: at its access layer, anyone who
  may update a document may publish it. The `publish` checkbox is this plugin's
  fence, not Payload's.
- Not covered in v1: `delete` (no tool exists and none is generated), uploads.
  Custom tools are trusted code and can do what the linked user may.

## Non-goals of v1 / roadmap

Unpublishing, `versions.drafts.localizeStatus`, deletes, uploads, markdown
authoring for rich text, addressing a rich text node
by position in a patch (an editor state is written whole), schemas for `upload`
node fields, row addressing by id instead of index, cross-locale publish
blockers, pagination of `describeSchema` with `expand`, and a handler-level
timeout are all deliberate omissions for now.

## License

Apache-2.0
