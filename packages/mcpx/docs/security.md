# Security

This page describes what an API key can reach through the MCP endpoint, as the code behaves now.
Known limitations are listed at the end, each with what an operator can do about it.

## Authentication

Only an API key authenticates. The handler reads `Authorization: Bearer <key>` and looks the key
up by its HMAC index. Cookies, admin sessions and JWTs are ignored: any user Payload resolved from
them before the handler ran is replaced by the key's user, and a request without a valid key gets
HTTP 401.

The default lookup refuses a key that is unknown or disabled, and a key whose user was deleted,
is unverified (`_verified: false`) or is locked out (`lockUntil` in the future).

The key collection is not an auth collection, so a key never authenticates Payload's REST or
GraphQL API.

## Capabilities

Two levels decide what a key may do. The plugin config sets the upper bound: which collections
and globals are exposed, and whether each is readable, writable as drafts, or writable live. The
key's checkboxes then grant operations within that bound. A checkbox that is missing or unticked
counts as no. Auth collections cannot be exposed at all, since their documents carry credentials.

### Who can create keys

By default, any user in the user collection can create a key and tick any capability the config
exposes. Each key is bound to the user who created it, and users see and change only their own
keys. To restrict who may create keys, override the collection's `create` access:

```ts
mcpxPlugin({
  collections: { pages: { read: true, write: "draft" } },
  apiKeys: {
    overrideCollection: (collection) => ({
      ...collection,
      access: {
        ...collection.access,
        // Assumes the user collection has a `role` field.
        create: ({ req }) => req.user?.role === "editor",
      },
    }),
  },
});
```

Existing keys keep working until they are disabled or deleted.

## Access control

A key acts as its user. Tool calls run with `req.user` set to that user, and the builtin tools
pass `overrideAccess: false` on the reads and writes they make for the client, so the
collections' access control applies to them.

### Relationship population

Read tools populate relations only into collections the key can read. A relation into any other
collection comes back as its id, as at depth 0, whatever `depth` the client asks for. This holds
for relationship and upload fields, joins and rich text nodes. A virtual field that resolves
through such a relation is left out of the response.

### Privileged reads

Some reads run with full access, because they answer a question about the whole document:

- After `patchDocument`, `createDocument` and `publishDocument` write, the tool re-reads the saved
  draft with `overrideAccess: true` and hidden fields included.
- `patchDocument` compares that read with what was sent to compute `notApplied`.
- `patchDocument`, `createDocument` and `validateDocument` run Payload's field validation over
  that read with `overrideAccess: true` to collect publish blockers. `validateDocument` first
  reads the document with the key's access and fails if the user cannot see it.
- The publish-blocker check runs the fields' `beforeValidate` and `beforeChange` hooks, including
  on `validateDocument`, which saves nothing.

What these reads return to the client: the document id (or the global's slug), `status`,
`updatedAt`, each publish blocker's message, pointer and field label, and the `notApplied`
pointers. Field values are not returned. A blocker can name a field the user cannot read, and a
custom `validate` function's message is passed on as written.

The key and user lookups during authentication also run with full access. They return nothing to
the client beyond accepting or refusing the key.

## Limits

These limits are fixed, not configurable, and checked after authentication:

| Limit                                       | Refusal                          |
| ------------------------------------------- | -------------------------------- |
| Request body over 4 MB                      | HTTP 413, JSON-RPC code `-32000` |
| More than 10 messages in a JSON-RPC batch   | HTTP 400, JSON-RPC code `-32600` |
| More than 500 operations in `patchDocument` | tool error, nothing is written   |
| More than 400 paths in `describeSchema`     | tool error                       |

A body that declares a larger `Content-Length` is refused unread. A body without one is read
until it passes 4 MB and then refused. `limits.maxLimit` and `limits.maxDepth` cap `limit` and
`depth` on the read tools.

## Input checks

A pointer with a segment named `__proto__`, `constructor` or `prototype` is refused, in
`patchDocument` operations (`path` and `from`) and in `getDocument`'s `path`. A
`createDocument` seed holding a `__proto__` key creates the document without that key.

A public Payload `APIError` reaches the client with its message and status, and a
`ValidationError` with its field errors. Any other error is reported as "Internal error" without
detail and logged on the server.

## The draft guard

The plugin installs hooks on every collection and global, exposed or not. For any create or
update carrying the MCP request marker, a `beforeOperation` hook forces a draft save and strips
the arguments that could publish or bypass it (`_status` and `deletedAt` in the data, `where`,
the publish, unpublish and selected locale arguments, `duplicateFromID`,
`overwriteExistingFiles`), and turns off `autosave`, `overrideLock` and `trash`. On every entity
with drafts, a `beforeChange` hook refuses a write that would still not save a draft, which also
catches `restoreVersion`. `publishDocument` is the only write that may publish.

Payload's global update reads its arguments before `beforeOperation` runs, so on a global only
the change to the data takes effect, and the `beforeChange` refusal is what keeps writes to drafts.

The guard does not cover:

- deletes;
- `duplicate`;
- files: the Local API moves `file` and `filePath` onto the request before the hook runs;
- direct `payload.db` access;
- collections and globals without drafts, where a write changes the live document;
- writes that do not carry the MCP `req`, since the marker travels on it.

## Custom tools and custom auth

Custom tools are trusted code. A handler receives the raw request with `req.user` set to the
key's user. Payload's Local API skips access control by default, so the tool must pass
`overrideAccess: false` and `req` to every call. Custom tools are not covered by the population
bound: a read on `req` populates relations into any collection the user's access allows. A tool
that defines `isEnabled` without checking its own checkbox is available to every key.

A custom `auth.resolve` must not trust `req.user`. Payload sets it from cookies before the handler
runs, and the handler only replaces it after `auth.resolve` returns.

## Known limitations

These are current behaviour.

- `findDocuments` accepts `where` and `sort` on fields of related documents, including related
  users, so a key can test the values of fields in collections it cannot read through MCP.
  Payload checks field-level `read` access on query paths, so set it on related fields a key's
  user must not test.
- Fields with `admin.hidden` are returned by `getDocument` and `findDocuments`, though
  `describeSchema` leaves them out; only Payload's top-level `hidden` is withheld. Use `hidden:
true` or field-level `read` access for values that must not reach clients.
- Once a document is readable, its older versions are readable subject only to the collection's
  `readVersions` access, so a read filter that depends on document content does not apply to old
  versions. Give `readVersions` a filter on the version fields that matches the `read` filter.
- `patchDocument`'s `notApplied` reveals whether a field the user may neither read nor update
  equals the value sent. Keep such fields out of collections exposed for write, or accept that
  their value can be confirmed.
- Calls in one JSON-RPC batch share a request and a transaction, so a failing call can roll back
  a write another call in the batch already reported as done. Clients that need independent
  writes send them in separate requests.
