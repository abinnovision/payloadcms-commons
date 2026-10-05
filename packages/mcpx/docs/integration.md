# Integration

## The endpoint

The plugin mounts the MCP endpoint at `endpoint.path` below Payload's API route, so
`/api/mcpx` by default. It speaks MCP over streamable HTTP, stateless and with JSON responses:
every request builds a fresh server, and no session is kept between requests. `GET` and `DELETE`
on the same path answer 405.

A request without a valid key gets HTTP 401 with JSON-RPC code `-32001` and a
`WWW-Authenticate: Bearer` header. The size limits are listed in
[security.md](./security.md#limits).

## Diagnostics

By default the server reports the repository as `websiteUrl` in its server info, and
`listCapabilities` returns a `server` block with the server name and version and links to the
repository and the issue tracker. A client can use it to file a useful bug report.
`diagnostics: false` removes both.

## Startup validation

The plugin checks its options when Payload builds the config and throws `InvalidConfiguration`
for any of these:

- a collection, global or user collection slug that does not exist, or a user collection that is
  not an auth collection;
- an exposed auth collection, read included, since its documents carry credentials such as the
  decrypted Payload API key of every user;
- an exposed `payload-*` collection or global, or the key collection itself;
- a key collection slug that another collection already uses;
- an entity value that is not `true` or an object, including `false` (remove the entry to hide the
  entity), and an object key other than `read`, `write`, `publish` and, on a collection,
  `delete`;
- a `read`, `write`, `publish` or `delete` value that is not `true` or `false`, including the
  old `write: "draft"` and `write: "live"`, apart from `delete: "unattended"`;
- `delete: "unattended"` on a collection without `trash: true`, since a delete without approval
  must only move to trash;
- `publish: true` on an entity without `versions.drafts`, or with `write: false`;
- `write: true`, `publish: true` or `delete` on an entity with `read: false`, since each needs read;
- `publish: false` on an entity without `versions.drafts`, since every write there goes live;
- `write` on a collection with `timestamps: false`, since the concurrency check needs `updatedAt`;
- a live `write` on an entity with `versions.drafts.localizeStatus`, which is not supported yet;
- two exposed collections, or two exposed globals, whose slugs map to the same camelCase
  capability name;
- a custom tool name that does not start with a letter, holds anything other than letters and
  digits, repeats another, or reuses a builtin name;
- `limits.maxLimit` below 1 or `limits.maxDepth` below 0, or either not an integer;
- `delete: true` together with `auth.resolve`, since approval lives on the key document.

## API keys

Keys live in the `mcpx-api-keys` collection, shown in the admin panel under MCP > API Keys. Each
key has a label, an `enabled` checkbox, an optional expiry, the user it acts as, the key itself,
the time it was last used and its capability checkboxes.

The key is generated on create: 32 random bytes, base64url encoded. It is stored encrypted with
Payload's secret, next to an HMAC index used for lookup, the same way Payload stores its own API
keys. Anyone who may read the key document sees the plaintext; by default that is the user who
created it. A key is bound to the user who created it, and that binding cannot be changed.
Unticking `enabled` refuses the key without deleting it.

A key with `expiresAt` set is refused from that time on. Leave it empty for a key that never
expires. `lastUsedAt` is read-only and set by the default key lookup on a successful request, at
most once an hour, so a key that no longer shows recent use is a candidate for removal. The write
also moves the key's `updatedAt`. A custom `auth.resolve` that does not call `resolveDefault`
replaces this lookup, so it owns the expiry check and the `lastUsedAt` bookkeeping itself.

By default, users read, update and delete only their own keys. Use
`apiKeys.overrideCollection` to change that, for example to let admins manage all keys, or to add
fields. [security.md](./security.md#who-can-create-keys) shows how to restrict who may create
keys.

### The capability matrix

The capabilities sit in their own tab on the key form. The checkboxes render as one table per
namespace (collections, globals, tools), side by side where the form is wide enough. A row names
the entity by its admin label, in the admin's language, with the slug beneath. It carries an
Access control with the segments None, Read, Write and Publish, where each level includes the ones
before it, and on collections a Delete checkbox. Each control explains itself in a tooltip. The
"All" row above the entities offers the same controls and applies a pick to every row, capped at
what each row exposes. While rows differ, it selects nothing. The tools table keeps a checkbox per
tool.

A checked Delete shows a shield beside it. The shield on means the key's user approves each
delete. Clicking it off moves documents to trash without approval, which is only possible where
the collection sets `delete: "unattended"`; elsewhere the shield stays on. The "All" row has no
shield, so no single click turns a whole namespace unattended.

A segment the config does not expose is left out, so a `write: false` collection reads as a config
decision rather than a refusal. Each grant needs the one before it: `publish` needs `write`, and
`write` and `delete` need `read`. Checking Delete on a row without access raises it to Read, and
setting access to None clears the delete. The Delete column appears only where a collection enables
delete. The controls write the stored checkboxes, the same `read`, `write`, `publish`, `delete`
and `deleteUnattended` flags.

### Waiting calls

Where a collection sets `delete: true`, a saved key lists the calls waiting for approval above
its tabs: one table per tool, a row per call with the collection, the document and a link to it,
whether it moves to trash or is permanent, and the reason the client gave. The title is the
published one, with the latest draft's title added where it differs, and the row names the
document's status. Each row has Approve
and Reject, and the footer approves or rejects every listed call. The `url` of a confirmation
opens this view with its row highlighted. Nothing is listed while no call waits, and a decision
never touches the key's form, so the key is not marked modified.

The list and the decisions go through `GET` and `POST` on `{routes.api}{endpoint.path}/confirmations`
with the admin session. Only the key's own user may use them.

### The "Connect a client" tab

Saved keys have a "Connect a client" tab showing the endpoint URL, the `Authorization` header and
ready-to-paste configuration for Claude Code and Claude Desktop, with the key filled in and a copy
button on each block. The tab appears only once the key exists. The URL uses `serverURL` when the
config sets one, and the browser's origin otherwise.

`apiKeys.setupGuide: false` removes the tab and the tab layout, leaving a flat form.

### Connecting other clients

Claude Desktop cannot send headers itself, so it goes through `mcp-remote`:

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

To try the endpoint by hand, run `npx @modelcontextprotocol/inspector` and choose the Streamable
HTTP transport with the same URL and header.

### Admin components

The key form renders the capability matrix and the setup guide from
`@abinnovision/payloadcms-mcpx/admin`, and the waiting calls where a collection sets
`delete: true`, so they must be in the import map:

```sh
payload generate:importmap
```

Without those entries Payload logs a missing-component error and renders nothing in their place.
Without the setup guide entry, the key form loses its "Connect a client" tab. Without the matrix
entry, it loses the capability editor, so no key can be granted anything from the admin panel. The
endpoint is unaffected.

## Custom key resolution

`auth.resolve` replaces the default lookup. It receives the request and `resolveDefault`, which
runs the default lookup, and returns an `McpxAuthResult` or `null` for a 401:

```ts
mcpxPlugin({
  collections: { pages: true },
  auth: {
    resolve: async ({ req, resolveDefault }) => {
      const result = await resolveDefault();

      if (result) {
        req.payload.logger.info(
          `MCP request with key ${String(result.apiKeyId)}`,
        );
      }

      return result;
    },
  },
});
```

`McpxAuthResult` carries `user` (with its `collection`), `apiKeyId` and `capabilities`, the
capability group as stored on a key document. The capabilities still pass through the config, so
a resolver cannot grant what the config does not expose. A result whose user has no `id` or is
not from the user collection, or that has no `apiKeyId`, is answered with 401. Do not authenticate from `req.user`; see
[security.md](./security.md#custom-tools-and-custom-auth).

The handler stamps `req.context.mcpx` with the key id and the resolved capabilities.
`isMcpxRequest(req)` reads that stamp, so your own hooks can tell an MCP write from any other.

## Upgrading to 2.0

### The `./admin` entrypoint

`@abinnovision/payloadcms-mcpx/client` is now `@abinnovision/payloadcms-mcpx/admin`, with no alias.
Change direct imports, then rerun `payload generate:importmap` and commit the result.

```ts
// before
import { McpxCapabilityMatrix } from "@abinnovision/payloadcms-mcpx/client";
// after
import { McpxCapabilityMatrix } from "@abinnovision/payloadcms-mcpx/admin";
```

### Entity options only take capabilities away

The config names the entities that are reachable and a key's checkboxes decide per key, so an
option now defaults to everything the entity supports. `write` is a boolean that defaults to
`true`, `publish` is a new boolean that defaults to `true` where the entity has drafts, and
`write: "draft"` and `write: "live"` are refused at startup. The `versions` option is gone and
is refused as an unknown option. Version history follows the key's read wherever the entity keeps
Payload `versions`. Without drafts, a write changes live content, as `write: "live"` did.

| before                        | after                           |
| ----------------------------- | ------------------------------- |
| `true`                        | `{ write: false }`              |
| `{ write: "draft" }`          | `{ publish: false }`            |
| `{ write: "live" }`           | `true`                          |
| `{ read: false, write: ... }` | `read: false` is unchanged      |
| `versions: true`              | remove it; history follows read |

Old versions follow `access.readVersions`, as they do in Payload's own API; see
[version history](./security.md#version-history).

Existing keys keep exactly what was ticked, so a key gains nothing from the wider ceiling until
someone ticks the new checkboxes. Entities that were read only now have write and publish
checkboxes on the key collection, so SQL database adapters need a migration for the new columns.
`false` as an entity value is refused, so remove the entry instead.

```ts
mcpxPlugin({
  collections: {
    pages: true,
    posts: { publish: false },
    tags: { write: false },
  },
});
```

### Custom tools: `McpxToolScope`

The slugs sit under `collections` and `globals`, and the locale settings under `localization`,
which is `null` when localization is off. `McpxScopeSlugs` types the slug groups.

```ts
// before
scope.readable;
scope.writableGlobals;
scope.locales;
scope.defaultLocale;
// after
scope.collections.readable;
scope.globals.writable;
scope.localization?.locales;
scope.localization?.defaultLocale;
```

### Custom tools: `PublishBlocker`

The type is no longer exported. A blocker is `{ path: string; message: string; field?: string }`.
Declare that shape where you need it.

### Custom tools: `mcpxReadRequest`

A read on `req` populates relations into every collection the user may read. Pass
`mcpxReadRequest(scope)` as `req` on reads to populate only into collections the key may read; see
[custom-tools.md](./custom-tools.md#reads). Keep `req` on writes.

### Relation filters

`findDocuments` refuses a `where` or `sort` that goes through a relation into a collection the key
cannot read, with a 400 error that names the path. Expose that collection with `read` and tick it
on the key, or filter on the relation's `id`.

### Hidden fields

`getDocument` and `findDocuments` no longer return fields with `admin.hidden`, and `findDocuments`
refuses a `where` or `sort` that names one. Drop `admin.hidden` from a field whose value clients
need. Custom tools are not filtered; see [security.md](./security.md#hidden-fields).

### `notApplied`

`patchDocument` computes `notApplied` from a read with the user's access, so a field the user cannot read
gives the same answer whatever value was sent. It is left out when the patch leaves the document
unreadable to the user.

### Batches

The calls in a JSON-RPC batch run one at a time, in order. Nothing to change unless a client
relied on calls overlapping.

### Tool descriptions

Tool descriptions and the server instructions are reworded. A client or test that matches their
text needs updating. The tools and their arguments are unchanged.

### Custom `auth.resolve`

A result that fails the checks in [Custom key resolution](#custom-key-resolution) now gets a 401
and one logged error. Check that your resolver returns a user with `id` and `collection` and an
`apiKeyId`.
