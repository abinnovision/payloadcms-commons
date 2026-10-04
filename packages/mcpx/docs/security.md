# Security

What an API key can reach through the MCP endpoint, and where that falls short. Each known
limitation at the end names a workaround.

## Authentication

Only an API key authenticates. The handler reads `Authorization: Bearer <key>` and looks the key
up by its HMAC index. Cookies, admin sessions and JWTs are ignored: any user Payload resolved from
them before the handler ran is replaced by the key's user, and a request without a valid key gets
HTTP 401.

The default lookup refuses a key that is unknown, disabled or expired, and a key whose user was deleted,
is unverified (`_verified: false`) or is locked out (`lockUntil` in the future).

The key collection is not an auth collection, so a key never authenticates Payload's REST or
GraphQL API.

## Capabilities

The plugin config sets the upper bound and the key's checkboxes grant operations within it, as
described under [Capabilities](../README.md#capabilities) in the README. A checkbox that is
missing or unticked counts as no. Auth collections cannot be exposed at all, since their documents
carry credentials.

`true` exposes everything the entity supports, so read the config as a ceiling: it names what a
key may be granted, and a key starts with every checkbox off. A new key can only call
`listCapabilities` until someone ticks something. Where an entity has no drafts, `write` changes
live content, and the key form marks that row. `publish: false` keeps writes as drafts on an
entity with drafts.

### Who can create keys

By default, any user in the user collection can create a key and tick any capability the config
exposes. Each key is bound to the user who created it, and users see and change only their own
keys. To restrict who may create keys, override the collection's `create` access:

```ts
mcpxPlugin({
  collections: { pages: { publish: false } },
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
through such a relation has nothing to resolve from, because the loader returns only the id, so
it comes back without a value.

### Queries through relations

`findDocuments` refuses a `where` or `sort` path that goes through a relationship, upload or join
field into a collection the key cannot read, with a 400 error that names the path. This covers
the `__` form of a path, `and` and `or` clauses at any depth, comma separated sort fields, and a
`virtual` field whose path resolves through such a relation. Naming the relation field itself, its
`id` (a join's too), or a polymorphic relation's `value` and `relationTo` is allowed, and so is a
path through a collection the key can read; see [known limitations](#known-limitations). A path
that matches no field is left to Payload.

### Hidden fields

`getDocument` and `findDocuments` leave out fields with `admin.hidden`, as `describeSchema` does.
This holds in groups, tabs, array rows, the rows of a `blocks` field, populated relationship, upload
and join documents, and the body of a version read by `versionId` or `diffFrom`. A virtual field is
judged by its own `admin.hidden`, not by the field it points at, for read output. `findDocuments`
also refuses a `where` or `sort` that names a hidden field, or a virtual field that points at one,
with the same 400 error as a path through an unreadable relation. The fields Payload adds to an
upload collection (`url`, `filename`, `sizes` and the rest) are returned, and the `id` of array and
block rows stays. For what this does not cover, see [known limitations](#known-limitations).

### Version history

Version history has no checkbox of its own. It follows the key's read wherever the entity keeps
Payload `versions`. For any other slug the slug is missing from `findVersions` (the tool is not
registered at all when the key reaches no entity with history) and `getDocument` refuses
`versionId` and `diffFrom`. The tools read the document with the key's access first. Old versions
are then governed by the collection's `access.readVersions`, which Payload defaults to any
logged-in user. A `read` rule that depends on document content does not apply to old versions, so
a document that passes it exposes older states it would have excluded. This is Payload behaviour:
the same user reaches those versions through the REST and GraphQL APIs and the admin.

Where `read` filters on content, give `readVersions` a filter on the version fields that matches
the `read` filter:

```ts
const published: CollectionConfig = {
  slug: "bulletins",
  versions: true,
  access: {
    read: () => ({ visibility: { equals: "public" } }),
    // Version fields sit under `version`.
    readVersions: () => ({ "version.visibility": { equals: "public" } }),
  },
  fields: [/* ... */],
};
```

### Privileged reads

Some reads run with full access, because they answer a question about the whole document:

- After `patchDocument`, `createDocument` and `publishDocument` write, the tool re-reads the saved
  draft with `overrideAccess: true` and hidden fields included.
- `patchDocument` computes `notApplied` from a second read with the key's access, not from that
  read, so a field the user cannot read gives the same answer whatever value was sent. When the
  patch leaves the document unreadable to the user, that read fails and `notApplied` is left out.
- `patchDocument`, `createDocument` and `validateDocument` run Payload's field validation over
  that read with `overrideAccess: true` to collect publish blockers. `validateDocument` first
  reads the document with the key's access and fails if the user cannot see it.
- The publish-blocker check runs the fields' `beforeValidate` and `beforeChange` hooks, including
  on `validateDocument`, which saves nothing. It runs once per locale on `validateDocument` without
  `locale` and once per other locale on `publishDocument`.

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
`depth` on the read tools. The tool handlers of a JSON-RPC batch run one at a time, each in its own
transaction.

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

A marked publish keeps `publishSpecificLocale`, which `publishDocument` sets for a single-locale
publish. Payload's global update reads its arguments before `beforeOperation` runs, so on a global
only the change to the data takes effect. The `beforeOperation` hook refuses a write that did not
ask for a draft save, and the `beforeChange` refusal keeps the status a draft.

A marked trash move from `deleteDocument` keeps `deletedAt` and is not saved as a draft, since a
draft save would leave the document itself, which carries `deletedAt`, unchanged. As the admin's
own move to trash, it writes the latest version to the document; the trashed document is not
public either way.

The guard does not cover:

- deletes;
- `duplicate`;
- files: the Local API moves `file` and `filePath` onto the request before the hook runs;
- direct `payload.db` access;
- collections and globals without drafts, where a write changes the live document;
- writes that do not carry the MCP `req`, since the marker travels on it.

## Uploads

A `createDocument` or `patchDocument` call with `file` writes nothing. It runs every check the
call runs, stores the call as a grant in Payload's KV and returns an `upload`: a URL, the method
`PUT` and the headers to send. The PUT to `{routes.api}{endpoint.path}/upload`, with the file as
its body, claims the grant and runs the same call again with the bytes attached. Its response body
is the result of that call, with HTTP 200 on success, 409 for a stale or locked document, 403 for
a refused grant and 422 for other problems.

The grant id in `x-mcpx-grant` is a bearer. Whoever holds it can complete that one call, as that
key, for 5 minutes, and only once. Keep it out of shared transcripts. The plugin never logs it,
but APM tools may record custom headers. Do not add `x-mcpx-grant` to `cors.headers`, so a page
on another origin cannot send it.

- The KV holds the HMAC of the grant id under the Payload secret, never the id itself. A row
  written there by other code or straight to the database cannot be claimed without the secret.
- The claim is a unique-key insert that no rollback undoes, so of two PUTs with one id exactly one
  runs. A failed PUT uses the grant up, and the client calls the tool again.
- The PUT reloads the key and refuses it when it was disabled, expired or unticked since, or its
  user is locked out or unverified. It always acts as the key's user, whatever cookie the request
  carries. `?locale` and `?uploadEdits` on the URL are ignored, so the locale is the one of the
  tool call.
- The body must have exactly the size the call declared. The request's `Content-Type` is ignored:
  the file carries the declared `mimeType`, which must match `upload.mimeTypes`.
- A patch is pinned to the `updatedAt` it was checked against. A change in between refuses the
  PUT as stale.
- A key may have 10 grants waiting at a time.

A `getDocument` call with `download: true` stores a grant of the same kind for the document it
read, with the same lifetime, single use and per-key limit. The GET to
`{routes.api}{endpoint.path}/file` claims it, reloads the key as the PUT does, checks that the key
still reads the collection and reloads the document as the key's user. It then hands the request
to the collection's own `/file/:filename` endpoint, so Payload's `access.read`, storage handlers
and `upload.modifyResponseHeaders` apply as for any request of that user. A document the user can
no longer read is refused with 403. A grant sent to the other endpoint, a download grant to the
PUT or an upload grant to the GET, is used up and refused. A storage adapter with
`disablePayloadAccessControl` serves its files itself, so this endpoint and Payload's file access
do not apply to them.

Uploads and downloads need all of the following, and no tool offers `file` or `download`
otherwise. `upload.mimeTypes` applies to uploads only:

- `upload.mimeTypes` on the collection. Payload checks the file content against it only where it
  is set; without it any type is stored, HTML and SVG included.
- Payload's database KV adapter, the default. The claim relies on its unique `key`.
- No `auth.resolve`. The PUT authenticates by the key alone and cannot replay a custom resolver.

Serve uploaded files so a browser does not run them: set `upload.modifyResponseHeaders` to add
`Content-Disposition: attachment` and `Content-Security-Policy: sandbox`, and set the same
headers on the bucket or CDN when files live in cloud storage.

Set `serverURL` in production. Without it, the handoff URL is built from the origin of the MCP
request, which comes from its `Host` or forwarded headers.

A file may be up to 25 MB, or `upload.limits.fileSize` when that is smaller. The body is buffered
in memory. A host with a smaller body limit, such as Vercel at about 4.5 MB, caps uploads at that.

Payload deletes the old file of a replace before it validates the document, and deletes it even
for a draft unless the latest version is published. Two refusals guard against losing a file
that is still in use:

- A replace is refused while the latest draft still uses the published file, for example after an
  alt-only edit. Publish or discard that draft first.
- Where Payload validates the write (no drafts, or `drafts.validate`), the document with the
  patches applied is validated before the call returns its `upload`, and refused if it fails.
  That check skips fields a client cannot write, such as `admin.hidden` fields a hook fills from
  the file. The upload itself is validated by Payload with all hooks and the file.

## Confirmations

`deleteDocument` writes nothing. It runs every check the delete runs: the key's `read` and `delete`
capabilities, a read of the document as the key's user, `access.delete` (and `access.update` for a
trash move), the trash state and `expectedUpdatedAt`. It then stores the call in Payload's KV with
the `updatedAt` it read, and returns a confirmation `id` and the URL of the key's edit view.

- The call is bound to the key that requested it. Only that key's `runConfirmed` finds it, and
  only the key's own user, in an admin session, can approve or reject it. The key is read with
  full access for that check, so a looser `read` rule on the key collection does not let another
  user decide. The id is therefore not a bearer, but the plugin never logs it.
- `delete: "unattended"` and the key's "Delete without approval" checkbox skip the approval for
  one collection: the call runs the same checks and moves the document to trash at once. It is
  refused at startup on a collection without `trash`, so a permanent delete always needs
  approval. The client cannot ask for it; only the key's checkbox decides.
- An approval or rejection is final. An approved call cannot be revoked; it runs on the next
  `runConfirmed` unless it expires first or the key loses the capability.
- Approving runs nothing. `runConfirmed` claims an approved call with the same unique-key insert
  as an upload grant, so it runs at most once, then runs it again as the key's user with
  `overrideAccess: false` and the MCP marker, in its own transaction. The key's current
  capabilities apply: a call the key no longer allows, a document changed since the request or
  access lost since is skipped and reported with the reason.
- A call expires 15 minutes after it was requested, approved or not. A key may have 50 calls
  stored at a time, apart from its 10 upload grants.
- The KV holds the HMAC of the id under the Payload secret. The admin panel addresses a call by
  that HMAC.
- On a collection with `trash: true` the delete moves the document to trash. A document already
  in trash is refused, so the plugin never empties trash. Without trash the document is deleted
  permanently with its file. Payload's `beforeDelete` and `afterDelete` hooks run as usual.
- Confirmations need Payload's database KV adapter, and `delete` is refused at startup together
  with `auth.resolve`, because approval lives on the key document.
- Set `serverURL` in production, so a confirmation URL is not built from the `Host` or forwarded
  headers of the MCP request.

## Custom tools and custom auth

Custom tools are trusted code. A handler receives the raw request with `req.user` set to the
key's user. Payload's Local API skips access control by default, so the tool must pass
`overrideAccess: false` and `req` to every call. A read that passes `mcpxReadRequest(scope)` is
held to the population bound; a read on the plain `req` populates relations into any collection
the user's access allows. A tool that defines `isEnabled` without checking its own checkbox is
available to every key.

A custom `auth.resolve` must not trust `req.user`. Payload sets it from cookies before the handler
runs, and the handler only replaces it after `auth.resolve` returns. The handler refuses a result
whose user has no `id` or whose `collection` is not the configured user collection, or that has no
`apiKeyId`, with the same 401 as an unknown key, and logs one error line.

## Known limitations

- `findDocuments` lets a `where` or `sort` go through a relation into a collection the key can
  read. That query is plain Payload behaviour: it is not subject to the related collection's
  row-level `read` rule, and Payload checks only field-level `read` access on the path. Set
  field-level `read` access on fields of the related collection that must not be tested.
- Rich text is not walked, so fields of block nodes and documents populated in nodes keep their
  `admin.hidden` fields. Set `hidden` or field-level `read` access on values that must not reach
  clients.
- Where an entity keeps Payload `versions`, old versions are governed by the collection's `access.readVersions`, not
  by its `read` rule. Payload lets any logged-in user through by default. See
  [Version history](#version-history) for a `readVersions` filter.
- `admin.hidden` set on a row, collapsible, unnamed group or tab is not applied to the fields
  inside it, in the schema or in reads; set it on the fields themselves.
- Custom tools are not stripped of `admin.hidden` fields, with `req` or `mcpxReadRequest(scope)`.
  A tool that must withhold them filters its own output.
