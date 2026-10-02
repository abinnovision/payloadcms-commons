# @abinnovision/payloadcms-mcpx

![A content model of any size funnels through nine fixed tools out to one client](https://raw.githubusercontent.com/abinnovision/payloadcms-commons/main/packages/mcpx/assets/header.png)

A [Payload CMS](https://payloadcms.com/) plugin that serves an MCP (Model Context Protocol) server
on one `POST` endpoint. Clients authenticate with API keys that users create in the admin panel.

The server has nine tools plus any you add, and that number does not grow with the content model.
A client reads the shape of one collection, block or rich text node at a time through
`describeSchema`, and writes with RFC 6902 JSON Patch operations that the plugin checks against
the real config before anything is saved. Writes land as drafts unless the config allows more,
and each write reports what still blocks publishing.
[`docs/concepts.md`](./docs/concepts.md) explains the model, and
[`docs/security.md`](./docs/security.md) states what a key can reach.

## Install

```sh
yarn add @abinnovision/payloadcms-mcpx
```

| Peer             | Range         | Needed for                                                     |
| ---------------- | ------------- | -------------------------------------------------------------- |
| `payload`        | `>=3.88.0 <4` | everything (required)                                          |
| `@payloadcms/ui` | `>=3.88.0 <4` | the admin components: capability matrix and "Connect a client" |
| `react`          | `^19`         | the admin components                                           |

`@payloadcms/ui` and `react` are optional. A deployment that does not serve the admin panel can
leave them out. The package is ESM only, like Payload.

## Setup

List the collections and globals the plugin may reach. Anything not listed is not exposed:

```ts
// payload.config.ts
import { mcpxPlugin } from "@abinnovision/payloadcms-mcpx";
import { buildConfig } from "payload";

export default buildConfig({
  // ...
  plugins: [
    mcpxPlugin({
      // pages and posts have versions.drafts enabled
      collections: {
        pages: { read: true, write: "live" }, // drafts, and publishDocument
        posts: { read: true, write: "draft" }, // drafts only
        tags: true, // shorthand for { read: true }
      },
      globals: {
        "site-settings": true,
      },
    }),
  ],
});
```

The plugin adds:

- `POST /api/mcpx`, an MCP endpoint over streamable HTTP. It is stateless and answers with JSON.
- An `mcpx-api-keys` collection in the admin group "MCP", holding the keys.
- A draft guard on every collection and global that turns MCP writes into draft saves.

The key form uses two admin components, so regenerate the import map:

```sh
payload generate:importmap
```

Without it, the key form loses the capability editor, so no key can be granted anything from the
admin panel. The endpoint itself is unaffected.

Then create a key in the admin panel under MCP > API Keys, tick what it may do, save, and copy
the key from the saved document. Every checkbox starts unticked, so a new key can only call
`listCapabilities`.

Connect a client with the key as a bearer token. Claude Code:

```sh
claude mcp add --transport http payload http://localhost:3000/api/mcpx \
  --header "Authorization: Bearer <key>"
```

Claude Desktop and the MCP Inspector are covered in
[`docs/integration.md`](./docs/integration.md#connecting-other-clients). Saved keys also have a
"Connect a client" tab with ready-to-paste snippets.

## Options

| Option                        | Default                                   | Description                                                         |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| `collections`                 | required                                  | Collections to expose. `true` means `{ read: true }`.               |
| `collections.<slug>.read`     | `true`                                    | Expose the read tools for this collection.                          |
| `collections.<slug>.write`    | `false`                                   | `"draft"`, `"live"` or `false`: how far writes reach.               |
| `collections.<slug>.versions` | `false`                                   | Expose version history. Needs Payload `versions` on the entity.     |
| `globals`                     | `{}`                                      | Globals to expose, with the same `read`, `write` and `versions`.    |
| `userCollection`              | `config.admin.user`, then `users`         | Auth collection whose users the keys act as.                        |
| `apiKeys.slug`                | `mcpx-api-keys`                           | Slug of the key collection.                                         |
| `apiKeys.setupGuide`          | `true`                                    | Add the "Connect a client" tab to saved keys.                       |
| `apiKeys.overrideCollection`  | none                                      | Function that receives the key collection and returns it.           |
| `endpoint.path`               | `/mcpx`                                   | Endpoint path below the API route.                                  |
| `limits.maxLimit`             | `25`                                      | Highest `limit` a client may pass to a list tool.                   |
| `limits.maxDepth`             | `1`                                       | Highest `depth` a client may pass to a read tool.                   |
| `tools`                       | `[]`                                      | Custom tools, see [`docs/custom-tools.md`](./docs/custom-tools.md). |
| `auth.resolve`                | none                                      | Replace or wrap the key lookup.                                     |
| `serverInfo`                  | `payloadcms-mcpx` and the package version | `{ name, version }` reported to clients.                            |

`write: "draft"` needs `versions.drafts` on the entity. `write: "live"` on an entity with drafts
exposes `publishDocument`; on one without drafts it lets writes change the live document.
`versions: true` exposes `findVersions` and the `versionId` and `diffFrom` arguments of
`getDocument` to keys that may read the entity. Old versions are then governed by the collection's
`access.readVersions`; see [`docs/security.md`](./docs/security.md#version-history).
Mistakes in the options fail at startup. [`docs/integration.md`](./docs/integration.md) lists
every check.

## Tools

| Tool               | What it does                                                       | Needs              |
| ------------------ | ------------------------------------------------------------------ | ------------------ |
| `listCapabilities` | Lists what this key may do. Clients call it first.                 | any key            |
| `describeSchema`   | Describes the fields at one schema path, with the paths below it.  | `read`             |
| `findDocuments`    | Queries a collection with a Payload `where`, `sort` and `select`.  | `read`             |
| `getDocument`      | Reads a document, a subtree of it, an old version or a diff.       | `read`             |
| `findVersions`     | Lists the version history of a document or global, without bodies. | `read`, `versions` |
| `patchDocument`    | Applies JSON Patch operations to the current draft.                | `write`            |
| `createDocument`   | Creates a draft from a seed. Not for upload collections.           | `write`            |
| `validateDocument` | Lists what blocks publishing, without saving.                      | `write`            |
| `publishDocument`  | Publishes the current draft.                                       | `write`, `publish` |

Collections and globals use the same tools. A tool that addresses one document takes either
`collection` and `id`, or `global` alone. [`docs/concepts.md`](./docs/concepts.md#tools) lists
every argument.

## Capabilities

A key can do something only when both the config and the key allow it.

The plugin config sets the upper bound: which collections and globals are exposed, and whether
each one is readable, writable as drafts, or writable live. A key cannot go past it.

Each key carries one checkbox per exposed entity and operation (`read`, `write`, `publish`), and
one per custom tool. The admin panel shows them as a matrix with a row per entity and a column per
operation. A cell the config does not expose shows a dash. `publish` exists only where the config
sets `write: "live"` on an entity with drafts, and counts only when `write` is ticked as well.

`tools/list` follows the key. A tool the key cannot use is not listed, and each `collection` and
`global` argument lists only the slugs the key may use with that tool. A checkbox added by a later
config change starts unticked on existing keys.

Any user in the user collection can create a key and tick every capability the config exposes.
To restrict that, use `apiKeys.overrideCollection` as shown in
[`docs/security.md`](./docs/security.md#who-can-create-keys).

## Security

- Only an API key authenticates. Admin sessions and JWTs are ignored, and a key does not work on
  the REST or GraphQL API.
- A key acts as its user, and Payload access control applies to what its tools read and write.
- Relations are populated only into collections the key can read.
- After a write, the tools re-read the document with full access to report `notApplied` and
  publish blockers. Blocker messages can name fields the user cannot read.
- The request body is limited to 4 MB, a JSON-RPC batch to 10 messages, `patchDocument` to 500
  operations and `describeSchema` to 400 paths.
- `findDocuments` refuses a `where` or `sort` that goes through a relation into a collection the
  key cannot read. Through a collection the key can read, Payload applies only field-level `read`
  access to the path. See [known limitations](./docs/security.md#known-limitations).
- Fields with `admin.hidden` are returned by the read tools. Only Payload's top-level `hidden`
  withholds a value. See [known limitations](./docs/security.md#known-limitations).
- Custom tools are trusted code and must apply access control themselves.

Details and known limitations: [`docs/security.md`](./docs/security.md).

## Documentation

- [`docs/concepts.md`](./docs/concepts.md): tool arguments, schema paths and pointers, patching,
  rich text, globals, uploads, drafts and publishing, versions and diffs.
- [`docs/integration.md`](./docs/integration.md): the endpoint, startup validation, API keys in the
  admin panel, and custom key resolution.
- [`docs/custom-tools.md`](./docs/custom-tools.md): defining your own tools.
- [`docs/security.md`](./docs/security.md): authentication, access, limits and known limitations.
- [`docs/limitations.md`](./docs/limitations.md): what the plugin does not do.
- [`docs/standards.md`](./docs/standards.md): test and comment standards for contributors.

## License

Apache-2.0
