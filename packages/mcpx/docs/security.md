# Security

What an API key can reach through the MCP endpoint, and where that falls short. Each known
limitation at the end names a workaround.

## Authentication

Two sources authenticate, tried in this order:

1. **A Payload auth strategy that attached MCP auth.** Payload runs the user collection's
   `auth.strategies` before any endpoint handler. A strategy that returns its user through
   `withMcpxAuth(user, { principal, capabilities })` hands that user and those capabilities to
   the endpoint. See
   [Capabilities from a Payload auth
   strategy](./integration.md#capabilities-from-a-payload-auth-strategy).
2. **An API key.** The handler reads `Authorization: Bearer <key>` and looks the key up by its
   HMAC index.

The MCP endpoint and the upload and download endpoints run Payload's auth strategies again
themselves, with `admin.autoLogin` disabled, and replace the user Payload resolved before the
handler ran. A request without credentials therefore never acts as the autologin user, and a
custom `auth.resolve` sees `req.user` as that second run resolved it. Until Payload lets an
endpoint skip its own auth pass, the strategies run twice on these endpoints. The confirmations
endpoint keeps Payload's own auth, since it serves the admin session, autologin included.

Cookies, admin sessions and JWTs alone get nothing: a user resolved from them carries no attached
auth, so the handler falls through to the key lookup and answers HTTP 401 without a valid key.
Any user resolved before the key lookup is replaced by the key's user.

The attached auth is a property keyed by `Symbol.for("@abinnovision/payloadcms-mcpx/auth")`. A
database row or a JSON body cannot carry a symbol key, so stored data and request bodies cannot
forge it; only server code such as a strategy can set it. A strategy that sets `req.user` already
acts as that user everywhere in Payload, and the plugin config caps the capabilities it attaches,
so the plugin accepts it from any strategy. A strategy cannot grant `deleteUnattended`: every
delete it asks for waits for approval. Malformed attached auth (a user outside the user
collection, a principal not matching `^[a-z][a-z0-9-]*:[A-Za-z0-9_-]+$`, or capabilities that are
not an object) is logged once and treated as absent: the handler goes on to the key lookup, which
answers 401 unless the request also carries a valid key.

The key is looked up by its HMAC index under every secret of Payload's keyring, the active secret
and `previousSecrets` on Payload 4, the same way Payload's own API key strategy does, so keys keep
working after a secret rotation. A key's index is written under the active secret, and saving the
key again re-indexes it. The stored key itself is encrypted with `payload.encrypt`, which Payload 4
decrypts under any keyring secret. Confirmation and grant ids are hashed under the active secret
only: they live at most 15 minutes, so those issued just before a rotation are refused after it
and the client asks again.

The default key lookup refuses a key that is unknown, disabled or expired, and a key whose user was
deleted,
is unverified (`_verified: false`) or is locked out (`lockUntil` in the future). A strategy makes
the same checks itself, as part of deciding who the request is.

The key collection is not an auth collection, so a key never authenticates Payload's REST or
GraphQL API. A request whose user carries attached MCP auth cannot create, read, update or delete
keys, so a strategy's credential cannot turn into a long-lived key.

## Capabilities

The plugin config sets the upper bound and the key's checkboxes grant operations within it, as
described under [Capabilities](../README.md#capabilities) in the README. A checkbox that is
missing or unticked counts as no. Auth collections cannot be exposed at all, since their documents
carry credentials.

The user's Payload access narrows the result once per request, through `getAccessResults`: a
capability is dropped where the user's access denies its operation on the entity (`read` for read,
`update` for write and publish, `delete` for delete), and what depends on it goes with it. Access
that answers with a query counts as allowed, because the tools run with `overrideAccess: false`
and the query applies then. This applies to keys and strategies alike, so `tools/list` and
`listCapabilities` only offer what the user could do. A user who may create but not update loses
`write` on that collection.

`true` exposes everything the entity supports, so read the config as a ceiling: it names what a
key may be granted, and a key starts with every checkbox off. A new key can only call
`listCapabilities` until someone ticks something. Where an entity has no drafts, `write` changes
live content, and the key form marks that row. `publish: false` keeps writes as drafts on an
entity with drafts.

Grants depend on each other: `publish` needs `write`, and `write` and `delete` need `read`. A key
without `read` cannot write, because a write-only key would still learn document contents: the
`test` patch operation answers whether a value matches, errors reveal structure, and the publish
checks re-read the document. A grant whose prerequisite is off counts as no, and the config
refuses `write`, `publish` or `delete` on an entity with `read: false`.

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
are then governed by the collection's `access.readVersions`. Payload 3 defaults it to any
logged-in user, so a `read` rule that depends on document content does not apply to old versions
and a document that passes it exposes older states it would have excluded. Payload 4 defaults it
to the collection's `read` access, so under a filtered `read` those older states stay hidden. This
is Payload behaviour: the same user reaches those versions through the REST and GraphQL APIs and
the admin.

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

- After `patchDocument`, `createDocument`, `duplicateDocument` and `publishDocument` write, the
  tool re-reads the saved draft with `overrideAccess: true` and hidden fields included.
- `patchDocument` computes `notApplied` from a second read with the key's access, not from that
  read, so a field the user cannot read gives the same answer whatever value was sent. When the
  patch leaves the document unreadable to the user, that read fails and `notApplied` is left out.
- `patchDocument`, `createDocument`, `duplicateDocument` and `validateDocument` run Payload's
  field validation over that read with `overrideAccess: true` to collect publish blockers.
  `validateDocument` first reads the document with the key's access and fails if the user cannot
  see it.
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

A marked publish keeps `publishAllLocales` and `publishSpecificLocale`, which `publishDocument`
sets for an all-locales and a single-locale publish. Payload 3 applies `publishSpecificLocale`
before `beforeOperation`; the guard still refuses a global write that did not ask for a draft
save, and the `beforeChange` refusal keeps the status a draft.

A marked trash move from `deleteDocument` keeps `deletedAt` and is not saved as a draft, since a
draft save would leave the document itself, which carries `deletedAt`, unchanged. As the admin's
own move to trash, it writes the latest version to the document; the trashed document is not
public either way.

A marked duplicate from `duplicateDocument` keeps `duplicateFromID` and is saved as a draft like
any other create.

The guard does not cover:

- deletes;
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

The grant id in `x-mcpx-grant` is a bearer for a key's grant. Whoever holds it can complete that
one call, as that key, for 5 minutes, and only once. A grant issued through a Payload auth
strategy also needs the strategy's credential: the PUT or GET must authenticate through the
strategy as the same principal and user, or it is refused and the grant stays claimable. Keep it out
of shared transcripts. The plugin never logs it,
but APM tools may record custom headers. Do not add `x-mcpx-grant` to `cors.headers`, so a page
on another origin cannot send it.

- The KV holds the HMAC of the grant id under the Payload secret, never the id itself. A row
  written there by other code or straight to the database cannot be claimed without the secret.
- The claim is a unique-key insert that no rollback undoes, so of two PUTs with one id exactly one
  runs. A failed PUT uses the grant up, and the client calls the tool again.
- The PUT reloads the key and refuses it when it was disabled, expired or unticked since, or its
  user is locked out or unverified. It always acts as the key's user, whatever cookie the request
  carries. For a strategy's grant it acts as the user the strategy resolved on the PUT, with the
  capabilities attached then. `?locale` and `?uploadEdits` on the URL are ignored, so the locale is
  the one of the
  tool call.
- The body must have exactly the size the call declared. The request's `Content-Type` is ignored:
  the file carries the declared `mimeType`, which must match `upload.mimeTypes`.
- A patch is pinned to the `updatedAt` it was checked against. A change in between refuses the
  PUT as stale.
- A key or strategy principal may have 10 grants waiting at a time.

A `getDocument` call with `download: true` stores a grant of the same kind for the document it
read, with the same lifetime, single use and per-principal limit. The GET to
`{routes.api}{endpoint.path}/file` claims it. A key's grant reloads the key as the PUT does; a
strategy's grant needs the same principal's strategy auth on the GET, else it is refused with 403
and stays claimable. The GET then checks that the client still reads the collection and reloads
the document as its user. It hands the request to the collection's own `/file/:filename`
endpoint, so Payload's `access.read`, storage handlers and `upload.modifyResponseHeaders` apply as
for any request of that user. A document the user can no longer read is refused with 403. A grant
sent to the other endpoint, a download grant to the PUT or an upload grant to the GET, is refused
with 403 and stays claimable at its own endpoint. A storage adapter with
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

`deleteDocument` writes nothing. It runs every check the delete runs: the `read` and `delete`
capabilities, a read of the document as the acting user, `access.delete` (and `access.update` for
a trash move), the trash state and `expectedUpdatedAt`. It then stores the call in Payload's KV
with the `updatedAt` it read and the acting user, and returns a confirmation with its `id` and
`principal`. A key's confirmation also carries the `url` of the key's edit view.

- The call is bound to its principal: the key id for a key, or the principal a strategy attached.
  Only that principal's `runConfirmed`, acting as the user who requested the call, finds it, so an
  approval survives a strategy rotating its credential as long as the principal and the user stay
  the same.
- Only the user who requested the call can approve or reject it, through the confirmations
  endpoint in a session without attached MCP auth. The decision must be sent as
  `application/json`, which a cross-origin form cannot send without a CORS preflight; any other
  type gets 415. A request that carries attached auth is refused with 403, so an agent holding a
  strategy's credential cannot approve its own calls. For
  a key principal, the endpoint also checks that the session user owns the key, read with full
  access, so a looser `read` rule on the key collection does not let another user decide. Calls
  requested by another user are neither listed nor decided. The id is therefore not a bearer, but
  the plugin never logs it.
- `delete: "unattended"` and a key whose Delete control is set to Trash skip the approval for
  one collection: the call runs the same checks and moves the document to trash at once. It is
  refused at startup on a collection without `trash`, so a permanent delete always needs
  approval. The client cannot ask for it; only the key's setting decides.
- An approval or rejection is final. An approved call cannot be revoked; it runs on the next
  `runConfirmed` unless it expires first or the key loses the capability.
- Approving runs nothing. `runConfirmed` claims an approved call with the same unique-key insert
  as an upload grant, so it runs at most once, then runs it again as the key's user with
  `overrideAccess: false` and the MCP marker, in its own transaction. The key's current
  capabilities apply: a call the key no longer allows, a document changed since the request or
  access lost since is skipped and reported with the reason.
- A call expires 15 minutes after it was requested, approved or not. A principal may have 50
  calls stored at a time, apart from its 10 upload grants.
- The KV holds the HMAC of the id under the Payload secret. The admin panel addresses a call by
  that HMAC.
- On a collection with `trash: true` the delete moves the document to trash. A document already
  in trash is refused, so the plugin never empties trash. Without trash the document is deleted
  permanently with its file. Payload's `beforeDelete` and `afterDelete` hooks run as usual.
- Confirmations need Payload's database KV adapter, and `delete` is refused at startup together
  with `auth.resolve`, because the confirmation and upload endpoints cannot replay a custom
  resolver.
- Set `serverURL` in production, so a confirmation URL is not built from the `Host` or forwarded
  headers of the MCP request.

## Custom tools and custom auth

Custom tools are trusted code. A handler receives the raw request with `req.user` set to the
key's user. Payload's Local API skips access control by default, so the tool must pass
`overrideAccess: false` and `req` to every call. A read that passes `mcpxReadRequest(scope)` is
held to the population bound; a read on the plain `req` populates relations into any collection
the user's access allows. A tool that defines `isEnabled` without checking its own checkbox is
available to every key.

A custom `auth.resolve` must not trust `req.user` unless it carries attached MCP auth. Payload sets
it from cookies before the handler runs, and the handler only replaces it after `auth.resolve`
returns. The handler refuses a result whose user has no `id` or whose `collection` is not the
configured user collection, or that has neither an `apiKeyId` nor a well-formed `principal`, or
both, with the same 401 as an unknown key, and logs one error line. With a custom resolver, uploads
and deletes stay unavailable for every source.

## Known limitations

- `findDocuments` lets a `where` or `sort` go through a relation into a collection the key can
  read. That query is plain Payload behaviour: it is not subject to the related collection's
  row-level `read` rule, and Payload checks only field-level `read` access on the path. Set
  field-level `read` access on fields of the related collection that must not be tested.
- Rich text is not walked, so fields of block nodes and documents populated in nodes keep their
  `admin.hidden` fields. Set `hidden` or field-level `read` access on values that must not reach
  clients.
- Where an entity keeps Payload `versions`, old versions are governed by the collection's
  `access.readVersions`, not
  by its `read` rule. Payload 3 lets any logged-in user through by default. Payload 4 inherits the
  collection's `read` access. See
  [Version history](#version-history) for a `readVersions` filter.
- `admin.hidden` set on a row, collapsible, unnamed group or tab is not applied to the fields
  inside it, in the schema or in reads; set it on the fields themselves.
- Custom tools are not stripped of `admin.hidden` fields, with `req` or `mcpxReadRequest(scope)`.
  A tool that must withhold them filters its own output.
