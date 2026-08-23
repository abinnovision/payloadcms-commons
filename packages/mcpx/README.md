# @abinnovision/payloadcms-mcpx

A Payload CMS plugin that mounts an MCP (Model Context Protocol) server whose
tool surface stays small and truthful, whatever the size of the content model.

Instead of generating one tool per collection with the full document schema
inlined, the plugin types its surface in three layers. The tool signatures are
tiny and static: collection slugs, locales and operations as enums, everything
else scalars. The field shapes are pulled on demand through `describeSchema`,
one node at a time, stopping at every blocks boundary. And every write is
resolved server-side against the real config and the real document, so unknown
fields, misplaced blocks and unusable rich text nodes are refused with the
valid alternatives listed, never silently dropped.

Writes are RFC 6902 patches that always land as drafts; publishing stays a
human action in the admin panel. Every write returns the list of publish
blockers, which is what still stands between the draft and a human being able
to publish it. Capabilities are declared twice: the plugin config decides what
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
- a draft guard on every collection, so any write carrying the MCP request
  marker lands as a draft, including writes made by custom tools.

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
reverse also holds, an admin session or JWT is ignored by the MCP endpoint.

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

The surface is fixed at seven tools plus your custom ones. `tools/list`
reflects the key: write tools disappear for read-only keys, and every
`collection` enum contains only the slugs the key may touch.

| Tool               | Purpose                                                         | Key arguments                                                                                |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `listCapabilities` | What this key may do; call first to orient.                     | none                                                                                         |
| `describeSchema`   | Field shape of a collection root or one block, pulled per node. | `collection`, `paths?`, `expand?`                                                            |
| `findDocuments`    | Query documents.                                                | `collection`, `where?`, `sort?`, `limit?`, `page?`, `depth?`, `select?`, `locale?`, `draft?` |
| `getDocument`      | Read one document or a subtree of it.                           | `collection`, `id`, `path?` (JSON pointer), `depth?`, `locale?`, `draft?`                    |
| `patchDocument`    | Apply RFC 6902 operations to the current draft.                 | `collection`, `id`, `locale`, `patches`, `expectedUpdatedAt?`                                |
| `createDocument`   | Create a draft from a minimal seed.                             | `collection`, `locale`, `data`                                                               |
| `validateDocument` | Publish blockers without writing.                               | `collection`, `id`, `locale`                                                                 |

Rules the tools enforce and explain in their own descriptions:

- `describeSchema` paths are dotted and stop at blocks fields, which list the
  block slugs they accept; append a slug to descend
  (`layout.sections.sectionWrapper`). A block is described as it exists at that
  position.
- A schema path becomes a patch pointer by replacing `.` with `/`, adding a
  leading `/`, and replacing each `[]` with a 0-based index.
- Adding a block requires `blockType` on the value; append with `/-`.
- Clearing is `replace` with `null`, emptying a list is `replace` with `[]`;
  `remove` is only valid on list elements, because Payload keeps fields absent
  from a write.
- Nothing in a patch batch is applied unless every operation validates first.
- Pass the `updatedAt` you read as `expectedUpdatedAt` so a concurrent edit is
  refused instead of overwritten.
- Fields Payload maintains (`id`, `_status`, `createdAt`, `updatedAt`,
  `deletedAt`) are never listed and never writable; `readOnly` fields are
  listed but refused on write.

## Drafts and publish blockers

Draft-only writing is enforced on the Payload operation, not in the tool
handlers: a `beforeOperation` hook forces `draft: true` and strips `_status`
from every write carrying the MCP request marker, so custom tools and anything
else writing through the same request are covered too. A `beforeChange` hook
refuses any write that would still not land as a draft.

Publish blockers are advisory. Payload skips validation on draft saves (unless
`versions.drafts.validate` is set), so after every write the plugin re-runs
Payload's own field validation over the saved draft and returns the failures
as `publishBlockers` with paths and labels. The write stands; the agent gets a
checklist and can converge. Two limits: only the written locale is validated,
and field `beforeChange` hooks run again during the check, so they must be
pure. Collections with `versions.drafts.validate: true` refuse invalid drafts
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

## Options

| Option                               | Default                        | Description                                                                                                        |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `collections`                        | required                       | Allow-list. `true` means `{ read: true }`.                                                                         |
| `collections.<slug>.read`            | `true`                         | Expose `describeSchema`, `findDocuments`, `getDocument`.                                                           |
| `collections.<slug>.write`           | `false`                        | Expose `patchDocument`, `createDocument`, `validateDocument`. Requires `versions.drafts` unless `allowLiveWrites`. |
| `collections.<slug>.allowLiveWrites` | `false`                        | Permit writes to a collection without drafts (they land live).                                                     |
| `userCollection`                     | `config.admin.user` or `users` | Auth collection the keys act as.                                                                                   |
| `apiKeys.slug`                       | `mcpx-api-keys`                | Slug of the generated key collection.                                                                              |
| `apiKeys.overrideCollection`         | none                           | Last-word override of the generated collection.                                                                    |
| `endpoint.path`                      | `/mcpx`                        | Endpoint path below the API route.                                                                                 |
| `limits.maxLimit`                    | `25`                           | Upper bound for `findDocuments.limit`.                                                                             |
| `limits.maxDepth`                    | `1`                            | Upper bound for `depth` on reads.                                                                                  |
| `tools`                              | `[]`                           | Custom tools.                                                                                                      |
| `auth.resolve`                       | none                           | Replace or wrap the default key resolution.                                                                        |
| `serverInfo`                         | package name and version       | Reported to MCP clients.                                                                                           |

Misconfiguration (unknown slugs, write on a collection without drafts, auth or
upload collections exposed for write, tool name collisions) fails at startup
with `InvalidConfiguration`.

## Security notes

- Keys are stored encrypted; lookup is by HMAC-SHA256 index derived from
  `payload.secret`, the same scheme Payload uses for its own API keys.
- The endpoint authenticates with Bearer keys only; admin JWTs and cookies are
  ignored. Keys cannot authenticate REST or GraphQL.
- Every operation runs under the linked user with `overrideAccess: false`.
- Not covered in v1: `delete` (no tool exists and none is generated), globals,
  uploads. Custom tools are trusted code and can do what the linked user may.

## Non-goals of v1 / roadmap

Globals, deletes, uploads, markdown authoring for rich text, row addressing by
id instead of index, cross-locale publish blockers, pagination of
`describeSchema` with `expand`, and a handler-level timeout are all deliberate
omissions for now.

## License

Apache-2.0
