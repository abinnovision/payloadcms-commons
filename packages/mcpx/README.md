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
fields, misplaced blocks and unusable rich text nodes are refused with the
valid alternatives listed, never silently dropped.

Writes are RFC 6902 patches that always land as drafts; publishing stays a
human action in the admin panel. Every write returns the publish
blockers: the validation failures that still prevent a human from publishing
the draft. Capabilities are declared twice: the plugin config decides what
can exist, a checkbox on each API key decides what does, and a missing checkbox
means no (fail-closed).

## Install

```bash
yarn add @abinnovision/payloadcms-mcpx
```

- Peer dependency: `payload >=3.88.0 <4`.
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
        pages: { read: true, write: true },
        posts: { read: true, write: true },
        tags: true, // shorthand for { read: true }
      },
      globals: {
        "site-settings": { read: true, write: true },
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
  capability existed stay without it.

Keys authenticate only the MCP endpoint. They are deliberately not a Payload
auth strategy, so a key can never authenticate the REST or GraphQL API; the
reverse also holds: an admin session or JWT is ignored by the MCP endpoint.

Use `apiKeys.overrideCollection` to widen access (for example, admins manage
all keys) or add fields.

## Connecting a client

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

The surface is fixed at seven tools plus your custom ones; exposing a global
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
| `validateDocument` | Publish blockers without writing.                           | `collection` + `id` \| `global`, `locale`                                                    |

Rules the tools enforce and explain in their own descriptions:

- `describeSchema` paths are dotted and stop at blocks fields, which list the
  block slugs they accept; every node carries `next`, the ready-to-use paths
  for those blocks (`layout.sections.sectionWrapper`), so pass an entry of
  `next` as a `paths` element to descend. A block is described as it exists at
  that position.
- Field and collection `admin.description` values are included in
  `describeSchema` and `listCapabilities`, so intent written for the admin
  panel reaches the client. Strings and locale-keyed records pass through;
  functions and components are dropped.
- Builtin tools reject unknown arguments by name instead of silently ignoring
  them.
- A schema path becomes a patch pointer by replacing `.` with `/`, adding a
  leading `/`, and replacing each `[]` with a 0-based index.
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

## Drafts and publish blockers

Draft-only writing is enforced on the Payload operation, not in the tool
handlers: a `beforeOperation` hook forces `draft: true` and strips `_status`
from every write carrying the MCP request marker, so custom tools and anything
else writing through the same request are covered too. A `beforeChange` hook
refuses any write that would still not land as a draft. Globals expose the same
`beforeOperation` interception point at the same position in the operation, so
they are guarded exactly as strongly as collections, exposed or not.

Publish blockers are advisory. Payload skips validation on draft saves (unless
`versions.drafts.validate` is set), so after every write the plugin re-runs
Payload's own field validation over the saved draft and returns the failures
as `publishBlockers` with paths and labels. The write stands; the client gets a
checklist of what remains. Three limits: only the written locale is
validated; field `beforeChange` hooks run again during the check, so they must
be pure; and the check runs privileged, so blocker paths and messages may name
fields the key's user cannot read (values are never included).
Collections with `versions.drafts.validate: true` refuse invalid drafts
outright; those failures come back as `validationErrors`.

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

Custom tool shapes are registered as given, and the MCP SDK wraps them in a
non-strict object: unknown arguments are stripped before your handler runs.
Builtin tools reject them instead.

## Options

| Option                               | Default                        | Description                                                                                                        |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `collections`                        | required                       | Allow-list. `true` means `{ read: true }`.                                                                         |
| `collections.<slug>.read`            | `true`                         | Expose `describeSchema`, `findDocuments`, `getDocument`.                                                           |
| `collections.<slug>.write`           | `false`                        | Expose `patchDocument`, `createDocument`, `validateDocument`. Requires `versions.drafts` unless `allowLiveWrites`. |
| `collections.<slug>.allowLiveWrites` | `false`                        | Permit writes to a collection without drafts (they land live).                                                     |
| `globals`                            | `{}`                           | Allow-list of globals. `true` means `{ read: true }`.                                                              |
| `globals.<slug>.read`                | `true`                         | Expose `describeSchema`, `getDocument`.                                                                            |
| `globals.<slug>.write`               | `false`                        | Expose `patchDocument`, `validateDocument`. Requires `versions.drafts` unless `allowLiveWrites`.                   |
| `globals.<slug>.allowLiveWrites`     | `false`                        | Permit writes to a global without drafts (they land live).                                                         |
| `userCollection`                     | `config.admin.user` or `users` | Auth collection the keys act as.                                                                                   |
| `apiKeys.slug`                       | `mcpx-api-keys`                | Slug of the generated key collection.                                                                              |
| `apiKeys.overrideCollection`         | none                           | Final override applied to the generated collection.                                                                |
| `endpoint.path`                      | `/mcpx`                        | Endpoint path below the API route.                                                                                 |
| `limits.maxLimit`                    | `25`                           | Upper bound for `findDocuments.limit`.                                                                             |
| `limits.maxDepth`                    | `1`                            | Upper bound for `depth` on reads.                                                                                  |
| `tools`                              | `[]`                           | Custom tools.                                                                                                      |
| `auth.resolve`                       | none                           | Replace or wrap the default key resolution.                                                                        |
| `serverInfo`                         | package name and version       | Reported to MCP clients.                                                                                           |

Misconfiguration (unknown slugs, write on a collection without drafts, upload
collections exposed for write, tool name collisions) fails at startup with
`InvalidConfiguration`. Auth collections cannot be exposed at all, read
included: their documents carry credentials, such as the decrypted Payload API
key of every user.

## Security notes

- Keys are stored encrypted; lookup is by HMAC-SHA256 index derived from
  `payload.secret`, the same scheme Payload uses for its own API keys.
- The endpoint authenticates with Bearer keys only; admin JWTs and cookies are
  ignored. Keys cannot authenticate REST or GraphQL.
- Every operation runs under the linked user with `overrideAccess: false`.
- Not covered in v1: `delete` (no tool exists and none is generated), uploads.
  Custom tools are trusted code and can do what the linked user may.

## Non-goals of v1 / roadmap

Deletes, uploads, markdown authoring for rich text, row addressing by id
instead of index, cross-locale publish blockers, pagination of `describeSchema`
with `expand`, and a handler-level timeout are all deliberate omissions for now.

## License

Apache-2.0
