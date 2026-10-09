# @abinnovision/payloadcms-mcpx

![A content model of any size funnels through a fixed set of tools out to one client](https://raw.githubusercontent.com/abinnovision/payloadcms-commons/main/packages/mcpx/assets/header.png)

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

List the collections and globals the plugin may reach. Anything not listed is not exposed, apart
from Payload's folders, which are readable where an exposed collection uses them (see `folders`):

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
        pages: true, // everything the collection supports
        posts: { publish: false }, // everything except publishing
        tags: { write: false }, // read only
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

The key form uses two admin components, three with `delete`, so regenerate the import map:

```sh
payload generate:importmap
```

Without it, no key can be granted anything from the admin panel. The endpoint is unaffected.

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
"Connect a client" button that opens ready-to-paste snippets.

## Options

| Option                       | Default                                   | Description                                                                                                                                       |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collections`                | required                                  | Collections to expose. `true` means `{}`, everything it supports.                                                                                 |
| `collections.<slug>.read`    | `true`                                    | Expose the read tools for this collection.                                                                                                        |
| `collections.<slug>.write`   | `true`                                    | Expose the write tools. Needs `read`. Without drafts, a write goes live.                                                                          |
| `collections.<slug>.publish` | `true` with drafts                        | Expose `publishDocument`. Needs `versions.drafts` and `write`.                                                                                    |
| `collections.<slug>.delete`  | `false`                                   | Expose `deleteDocument`. Needs `read`. Each delete is approved in the admin. `"unattended"` also offers trashing without approval; needs `trash`. |
| `globals`                    | `{}`                                      | Globals to expose, with `read`, `write` and `publish`.                                                                                            |
| `folders`                    | read-only where used                      | Payload's folders, where an exposed collection uses them. `{ write: true }` adds create and rename, never delete. `false` hides them.             |
| `userCollection`             | `config.admin.user`, then `users`         | Auth collection whose users the keys act as.                                                                                                      |
| `apiKeys.slug`               | `mcpx-api-keys`                           | Slug of the key collection.                                                                                                                       |
| `apiKeys.setupGuide`         | `true`                                    | Add the "Connect a client" button to saved keys.                                                                                                  |
| `apiKeys.overrideCollection` | none                                      | Function that receives the key collection and returns it.                                                                                         |
| `endpoint.path`              | `/mcpx`                                   | Endpoint path below the API route.                                                                                                                |
| `limits.maxLimit`            | `25`                                      | Highest `limit` a client may pass to a list tool.                                                                                                 |
| `limits.maxDepth`            | `1`                                       | Highest `depth` a client may pass to a read tool.                                                                                                 |
| `tools`                      | `[]`                                      | Custom tools, see [`docs/custom-tools.md`](./docs/custom-tools.md).                                                                               |
| `auth.resolve`               | none                                      | Replace or wrap the key lookup.                                                                                                                   |
| `serverInfo`                 | `payloadcms-mcpx` and the package version | `{ name, version }` reported to clients.                                                                                                          |
| `diagnostics`                | `true`                                    | Expose the server version plus repository and issue links.                                                                                        |

The config only takes capabilities away: `true` exposes everything the entity supports, and a key's
checkboxes decide what each key may do. `publish: false` keeps MCP writes as drafts. On an entity
without drafts, a write changes the live document. Version history has no checkbox of its own: it
follows the key's read wherever the entity keeps Payload `versions`. Read
[version history](./docs/security.md#version-history) first.
Mistakes in the options fail at startup. [`docs/integration.md`](./docs/integration.md) lists
every check.

## Tools

| Tool                | What it does                                                       | Needs     |
| ------------------- | ------------------------------------------------------------------ | --------- |
| `listCapabilities`  | Lists what this key may do. Clients call it first.                 | any key   |
| `describeSchema`    | Describes the fields at one schema path, with the paths below it.  | `read`    |
| `findDocuments`     | Queries a collection with a Payload `where`, `sort` and `select`.  | `read`    |
| `getDocument`       | Reads a document, a subtree of it, an old version or a diff.       | `read`    |
| `findVersions`      | Lists the version history of a document or global, without bodies. | `read`    |
| `patchDocument`     | Applies JSON Patch operations to the current draft, or a new file. | `write`   |
| `createDocument`    | Creates a draft from a seed, with a file in an upload collection.  | `write`   |
| `duplicateDocument` | Copies a document into a new draft, in every locale.               | `write`   |
| `validateDocument`  | Lists what blocks publishing, without saving.                      | `write`   |
| `publishDocument`   | Publishes the current draft.                                       | `publish` |
| `deleteDocument`    | Asks to delete a document, which the key's user approves.          | `delete`  |
| `runConfirmed`      | Runs the approved calls.                                           | `delete`  |

Collections and globals use the same tools. A tool that addresses one document takes either
`collection` and `id`, or `global` alone. [`docs/concepts.md`](./docs/concepts.md#tools) lists
every argument.

## Capabilities

A key can do something only when both the config and the key allow it.

The plugin config sets the upper bound: which collections and globals are exposed, and whether
each one is readable, writable and publishable. A key cannot go past it.

Each key carries one checkbox per exposed entity and operation (`read`, `write`, `publish`,
`delete`, `deleteUnattended`), and
one per custom tool. The admin panel shows them as a matrix with a row per entity, an Access
control (None, Read, Write, Publish) and a Delete checkbox with an approval shield. Each access level
includes the ones before it, and a level the config does not expose has no segment. `publish`
exists only where the config exposes `write` and `publish` on an entity with drafts, and counts
only when `write` is ticked as well. `write` counts only when `read` is ticked, so a key never
writes what it cannot read. An entity without drafts carries a "Live" badge, as its writes go live
immediately.
`delete` exists only where the config sets `delete: true` on a collection, and counts only when
`read` is ticked as well. Setting access to None clears it. A delete runs only after the key's user
approved it on the key's edit view, except where the config sets `delete: "unattended"` and the
key's approval shield is off: there the document moves to trash at once. See
[deleting](./docs/concepts.md#deleting).

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
- Readable folders expose every folder name and the `folderType` options, which are the slugs of
  the collections that use folders. They do not expose the documents in a folder.
- The read tools leave out fields with `admin.hidden`. `findDocuments` refuses a `where` or `sort`
  that names one, or that goes through a relation into a collection the key cannot read.
- After a write, the tools re-read the document with full access to report publish blockers.
  Blocker messages can name fields the user cannot read.
- The request body is limited to 4 MB, a JSON-RPC batch to 10 messages, `patchDocument` to 500
  operations and `describeSchema` to 400 paths.
- A file is sent in a second step, a `PUT`, and downloaded with a `GET`, each with a short-lived,
  single-use grant. Only collections with `upload.mimeTypes` take files. Downloads go through the
  collection's own file access. See [uploads](./docs/security.md#uploads).
- A delete waits for the key's user to approve it in the admin panel and is then run by the same
  key. Collections with `trash` move the document to trash. See
  [confirmations](./docs/security.md#confirmations).
- Custom tools are trusted code and must apply access control themselves.

Open limitations: a filter through a relation into a readable collection ignores that collection's
row-level `read` rule, rich text is not walked for hidden fields, and `admin.hidden` on a row, tab
or collapsible does not reach the fields inside it. Details:
[`docs/security.md`](./docs/security.md).

## Documentation

Upgrading from 1.x: [Upgrading to 2.0](./docs/integration.md#upgrading-to-20).

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
