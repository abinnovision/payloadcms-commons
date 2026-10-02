# Integration

## The endpoint

The plugin mounts the MCP endpoint at `endpoint.path` below Payload's API route, so
`/api/mcpx` by default. It speaks MCP over streamable HTTP, stateless and with JSON responses:
every request builds a fresh server, and no session is kept between requests. `GET` and `DELETE`
on the same path answer 405.

A request without a valid key gets HTTP 401 with JSON-RPC code `-32001` and a
`WWW-Authenticate: Bearer` header. The size limits are listed in
[security.md](./security.md#limits).

## Startup validation

The plugin checks its options when Payload builds the config and throws `InvalidConfiguration`
for any of these:

- a collection, global or user collection slug that does not exist, or a user collection that is
  not an auth collection;
- an exposed auth collection, read included, since its documents carry credentials such as the
  decrypted Payload API key of every user;
- an exposed `payload-*` collection or global, or the key collection itself;
- a key collection slug that another collection already uses;
- a `write` value other than `false`, `"draft"` or `"live"`;
- a `versions` value other than `true` or `false`, `versions: true` on an entity without Payload
  `versions`, or `versions: true` with `read: false`;
- `write: "draft"` on an entity without `versions.drafts`;
- `write` on a collection with `timestamps: false`, since the concurrency check needs `updatedAt`;
- `write: "live"` on an entity with `versions.drafts.localizeStatus`, which is not supported yet;
- two exposed collections, or two exposed globals, whose slugs map to the same camelCase
  capability name;
- a custom tool name that does not start with a letter, holds anything other than letters and
  digits, repeats another, or reuses a builtin name;
- `limits.maxLimit` below 1 or `limits.maxDepth` below 0, or either not an integer.

## API keys

Keys live in the `mcpx-api-keys` collection, shown in the admin panel under MCP > API Keys. Each
key has a label, an `enabled` checkbox, the user it acts as, the key itself and its capability
checkboxes.

The key is generated on create: 32 random bytes, base64url encoded. It is stored encrypted with
Payload's secret, next to an HMAC index used for lookup, the same way Payload stores its own API
keys. Anyone who may read the key document sees the plaintext; by default that is the user who
created it. A key is bound to the user who created it, and that binding cannot be changed.
Unticking `enabled` refuses the key without deleting it.

By default, users read, update and delete only their own keys. Use
`apiKeys.overrideCollection` to change that, for example to let admins manage all keys, or to add
fields. [security.md](./security.md#who-can-create-keys) shows how to restrict who may create
keys.

### The capability matrix

The capability checkboxes render as one table per namespace (collections, globals, tools): a row
per entity or tool, a column per operation, and a toggle in each column header that sets or
clears the whole column. Clicking a row's name does the same for the row. Each column header
explains its operation.

A cell the config does not expose shows a dash, so a `write: false` collection reads as a config
decision rather than an unticked box. A column that no row exposes is left out. Ticking `publish`
also ticks `write`, and clearing `write` clears `publish`.

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
`@abinnovision/payloadcms-mcpx/admin`, so both must be in the import map:

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
a resolver cannot grant what the config does not expose. Do not authenticate from `req.user`; see
[security.md](./security.md#custom-tools-and-custom-auth).

The handler stamps `req.context.mcpx` with the key id and the resolved capabilities.
`isMcpxRequest(req)` reads that stamp, so your own hooks can tell an MCP write from any other.

## Upgrading to 2.0

The admin components moved from `@abinnovision/payloadcms-mcpx/client` to
`@abinnovision/payloadcms-mcpx/admin`. There is no `/client` alias.

- Rerun `payload generate:importmap` and commit the result.
- Change direct imports of `McpxCapabilityMatrix` or `McpxSetupGuide` to
  `@abinnovision/payloadcms-mcpx/admin`.

`McpxToolScope` groups its slugs and its locale settings. Rename the fields in custom tools:

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

Version history is hidden by default. `findVersions`, `versionId` and `diffFrom` are refused until
an entity sets `versions: true`. Set `access.readVersions` before opting in if the entity's `read`
rule depends on document content, since old versions follow `readVersions` and Payload defaults it
to any logged-in user. See [security.md](./security.md#version-history).

`getDocument` and `findDocuments` no longer return fields with `admin.hidden`, and `findDocuments`
refuses a `where` or `sort` that names one. Payload's own upload fields are still returned.
Drop `admin.hidden` from a field whose value clients need.

`PublishBlocker` is no longer exported.
