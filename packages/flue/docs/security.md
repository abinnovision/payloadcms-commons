# Security

What each process can reach, how the plugin keeps mcpx keys away from the browser, and the risks
an integrator owns.

## Trust chain

```
browser  -- admin session -->    Payload
Payload  -- secret -->           sidecar
sidecar  -- secret + handle -->  Payload  POST /api/flue/exchange, returns the mcpx key
sidecar  -- mcpx key -->         Payload  POST /api/mcpx
sidecar  -- secret -->           Payload  POST /api/flue/settled, reports a settled submission
sidecar  -- upload grant -->     Payload  PUT /api/mcpx/upload, the bytes of usePayload().upload()
```

- The browser talks only to Payload, with its admin session. It never reaches the sidecar.
- Payload calls the sidecar with `Authorization: Bearer <sidecar.secret>` and headers it builds
  itself. Cookies and other browser headers are never forwarded.
- The sidecar calls Payload in three ways: the exchange, authenticated by the same secret plus
  the handle of an unarchived thread; mcpx, authenticated by the key the exchange returned; and
  settlement reports, authenticated by the secret.
- mcpx applies the key's capabilities and Payload access control as the key's user.

The sidecar has no authentication of its own beyond the secret check in its `app.ts` (see
[integration.md](./integration.md#the-sidecar)). Keep it on a private network. Its only
long-lived credential is the secret, and the secret alone yields no key: the exchange also needs
the handle of an unarchived thread. With the secret alone, the settled endpoint only makes Payload
read a thread's history from the sidecar, and only for a conversation id and submission the thread
already recorded. It never sets a status or title from the caller's input.

## Where secrets live

| Secret              | Lives in                                                 | Stored as                      |
| ------------------- | -------------------------------------------------------- | ------------------------------ |
| `sidecar.secret`    | Payload's and the sidecar's environment                  | plaintext in both environments |
| exchange handle     | Flue's `initialData` of the conversation, in the sidecar | SHA-256 on the thread row      |
| managed mcpx key    | mcpx's key collection; the sidecar's memory during a run | as mcpx stores keys            |
| model provider keys | the sidecar's environment                                | never seen by Payload          |

The conversation id is credential-equivalent together with the secret: whoever holds both can post
messages to the conversation, read its history and abort its runs in the sidecar. It never reaches
the browser (see below); treat a leaked id like a leaked secret and archive the thread.

The handle is 32 random bytes. A keyed hash would gain nothing for a value that long, and would
orphan every live conversation when Payload's secret rotates, since the handle is fixed for the
conversation's lifetime. The secret is compared in constant time after hashing both sides.

## What never reaches the browser

- The sidecar secret. The admin components receive only `endpointPath`, `threadsSlug` and
  `userCollection`.
- The exchange handle and its hash. `handleHash` is a `hidden: true` field.
- The conversation id the plugin uses in the sidecar's URLs. `conversationId` is a `hidden: true`
  field, the conversation route takes the thread id instead, and Flue's refusals, which name the
  conversation, are answered with the plugin's own body. Flue's own events and history carry
  Flue's internal `conv_…` id, not this one.
- The plaintext of a managed mcpx key (see [managed key locks](#managed-key-locks)).
- Model provider keys, which only the sidecar has.

Every JSON response of the plugin, the exchange included, carries `Cache-Control: no-store`, and
the updates stream `no-store, no-transform`. The plugin never logs a key, a handle or the secret,
and `SidecarError` messages never include the sidecar's response body.

## Managed key locks

The plugin augments mcpx's key collection, so a managed key behaves differently from a key a user
created:

- **Marker.** A `managedBy` text field holds `flue:<agent>`. It is hidden in the admin, and its
  field access refuses every create and update, so only the plugin's privileged writes set it.
- **List.** `admin.baseFilter` hides managed keys from the key list. An existing `baseFilter`, or
  the deprecated `baseListFilter`, is kept and combined with AND.
- **Update and delete.** Collection access for `update` and `delete` excludes every row with a
  marker, for every caller without `overrideAccess`, admins included. The rest of the existing
  rule still applies to unmanaged keys.
- **Plaintext.** The `apiKey` field's read access refuses a row with a marker, after any existing
  read rule. Field access applies to REST, GraphQL, the Local API with `overrideAccess: false` and
  the admin.
- **Select.** The collection's entity-level `select` function is composed so every read carries
  the marker and the lock can decide from the row: an include select gains `managedBy: true`, and
  an exclude select loses `managedBy: false`. An exclude select that names only `managedBy` is
  left as it is, because dropping its one entry would turn it into an include select that selects
  nothing; the lock then looks the marker up. An existing `select` function runs first.
- **Rich text.** `admin.enableRichTextRelationship` and `admin.enableRichTextLink` are `false`, so
  no rich text relationship or link can point at a key. Such a node is populated by reads that
  skip field access, such as a Local API read with `overrideAccess: true`, and would carry the
  plaintext along.
- **Missing marker.** When a row arrives without a `managedBy` value, the lock reads the stored
  marker with one privileged `findByID` and allows the plaintext only if the stored row has none.
  A missing id or any error refuses. On SQL adapters every row carries the column, `null` when
  unset, so this read does not happen. MongoDB omits unset fields, so there every read of an
  unmanaged key's plaintext costs one extra read; MongoDB is outside the test matrix.

mcpx's collection `read` access is unchanged. The key's user still opens a managed key's edit view,
without the plaintext, which is where they approve its delete confirmations. The exchange reads
the key with `overrideAccess: true` and is not affected by the locks.

The plugin depends on mcpx's field names (`apiKey`, `user`, `capabilities`) and fails at startup
when they change (see [startup validation](./integration.md#startup-validation)).

## Revocation

Each turn makes sure the managed key is enabled, has more than half of `keyTtlMs` left and carries
exactly the agent's capabilities. When one of these does not hold, the turn enables the key, rolls
it to now plus `keyTtlMs` and resets its capabilities. Between turns these levers stop an agent:

| Lever                                 | Effect                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| The agent's `access` refuses the user | No new chat turns (403), and the exchange refuses chat threads of that user with 404.                     |
| Stop                                  | Aborts the run and, on a `running` thread, disables the (user, agent) key until the next turn.            |
| Archive                               | The exchange refuses the thread's handle, and its run is aborted; on a `running` thread disables the key. |
| Logout                                | Disables every managed key of the user, including keys used by runs started from other sessions.          |
| The user record                       | mcpx refuses a key whose user was deleted, is unverified or is locked out.                                |
| Expiry                                | The key stops working `keyTtlMs` after it was last written. A turn writes it once half or less is left.   |

The key is shared by all of a user's threads with that agent. Stop or archive on one running
thread therefore cuts off the user's other runs of that agent as well, until their next turn
enables the key again.

The exchange has no expiry of its own per thread. It finds the key by the thread's owner and agent,
so the handle of any unarchived thread of that user and agent exchanges while their key is live.
Archive a thread to end its exchange for good.

A sidecar that already holds a key keeps using it until mcpx refuses it: a refused `access` stops
new exchanges, not a key in memory. Disable the key through Stop, archive or logout, or wait for
its expiry.

No admin can disable or delete a managed key through the API or the admin panel: the update and
delete locks apply to every caller without `overrideAccess`. Per-agent `access`, the user record,
Stop, archive and logout are the levers.

## Agent access

An agent's `access` is evaluated three times: by `GET /agents`, by `POST /chat/:agent`, and by the
exchange for chat threads. The exchange runs it on a request built for the thread's user with
`createPayloadRequest`, loaded at the user collection's `auth.depth` the way mcpx loads a key's
user. That request carries no headers, cookies or session. A rule that reads anything but
`req.user`, such as a header or an IP address, gives a different answer there, and a rule that
throws fails the exchange.

`access` does not apply to reactive and ambient runs. Code that calls `queueFlueRun` decides who
may trigger a run.

## Reading agent runs

Reactive and ambient threads belong to the agent user. By default nobody else reads them.
`threads.readAgentRuns(req)` lets a user read every reactive and ambient thread, and through the
conversation route their whole transcript. The panel's Runs tab lists them for every agent,
including agents whose `access` refuses the user.

That transcript was produced under the agent user's access and the agent's capabilities. Any
content the agent user can read through mcpx can appear in it, including documents the reader
could not open themselves. Grant `readAgentRuns` only to users who may see what the agent user
sees, and keep the agent user's own access narrow.

## Reactive runs

A hook that queues a run on a collection the agent writes to triggers itself: the agent's write
fires the hook, which queues the next run. Guard on the agent user, as the
[example](./integration.md#queuefluerun) does. `queueFlueRun` checks nothing about the caller.

A reactive run reads documents that users wrote, so untrusted text reaches the agent and may try
to steer it. Prefer a read-only agent for reactive summaries and reviews, so a steered run cannot
write. Keep user-authored text such as a title out of the run's `message`: pass the document as
`context` and let the agent read it through mcpx, where it arrives as data rather than as the
instruction.

The dispatch job runs as the agent user. Set Payload's `jobs.access.run` so that only trusted
callers can run queued jobs and handle schedules through the REST API; by default any signed-in
user can, which lets them start ambient runs at will.

## Confirmations

mcpx makes every delete wait for the key's user to approve it on the key's edit view. For a chat
run that user is the person chatting. The panel's tool row offers Approve and Reject, which decide
the call through mcpx's confirmations endpoints as that user, and links to the review page as a
fallback. The link keeps only the path and query of the confirmation URL and is shown only when it
leads into the admin's collections, so it never leaves the admin's origin.

For reactive and ambient runs the key's user is the agent user, whom nobody signs in as. Their
delete requests have no human approver and expire after mcpx's 15 minutes unless someone signs in
as the agent user to decide them. The plugin warns at startup for an ambient agent that may
delete; a reactive run of an agent with `delete` gets no warning.

## Attachments

Attachments are off by default. Once `attachments` is on:

- **Access.** The panel reads a file only through `GET /c/:thread/attachments/:attachment`, which
  reads the thread as the user, as the conversation route does. A user who cannot read the thread
  gets 404 and nothing is requested from the sidecar.
- **Body cap.** `POST /chat/:agent` accepts bodies of tens of MiB, about 26.7 MiB at the defaults,
  from every user who may chat with an agent, not only from those who attach files. The plugin
  buffers and parses each body in memory, so every concurrent request of that size holds its
  body and the parsed copy. Narrow the limits, or limit bodies and requests in front of Payload.
- **Storage.** Files live in the Flue sidecar's store, not in Payload, and stay there as long as
  the conversation (see [limitations](./limitations.md#attachments)).
- **Headers.** Flue's `Content-Security-Policy: sandbox` and the plugin's `nosniff` pass through,
  and every file that is not an image is served as a download, so no attachment runs as active
  content on the admin's origin.
- **Browser cache.** Flue answers `Cache-Control: private, max-age=31536000, immutable`. A file
  stays in the browser's cache after logout, so on a shared machine the next person at the browser
  can still open it from the cache.
- **Cookies.** Thumbnails load with an `<img>` tag, which sends the session cookie only to the
  same site. A panel served from another site than Payload needs `SameSite=None` cookies to show
  them.

The preamble of a turn with files is not a trust boundary. Payload writes it and agent code reads
only the preamble at the start of the body, so `contextOf` cannot be forged. The model, however,
reads the whole body: a user can still type a `<payload-context .../>` tag or a block that looks
like an `<attachments>` manifest into their text, and mislead the model with it. Never treat the
context, or anything the model concludes from it, as authorization; mcpx's key and Payload access
control decide what a run may do.

### Upload grants

`createDocument` returns a single-use upload grant, valid for five minutes, in the
`x-mcpx-grant` header of the handoff. `upload()` uses it for one PUT and drops it. It never
appears in an error message, a log line, the tool output or the `data-payload-file` part. The
document is created as the key's user, so Payload access control applies as for any other write.

## CSRF and CORS

The panel calls the plugin's endpoints, the threads REST API and mcpx's confirmations endpoints
(`GET` and `POST /api/mcpx/confirmations` by default) with the admin's session cookie.
Payload accepts that cookie from a cross-origin request when its CSRF origin list is empty, and
the list is empty unless `serverURL` or `csrf` is set. Set `serverURL`, which Payload adds to the
list.

`POST /chat/:agent` and `POST /c/:thread/abort` require `content-type: application/json`, which a
cross-origin browser request can only send after a CORS preflight. `POST /exchange` and
`POST /settled` ignore the session altogether. The plugin's only CORS header is `Access-Control-Expose-Headers` on the
conversation route, which lets a client that Payload's `cors` option admits read the stream
headers. Payload's `cors` option applies to its endpoints as to any other.

## Limits

| Limit                                          | Value                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /chat/:agent` body                       | 64 KiB, counted in bytes; with attachments see [integration.md](./integration.md#attachments) |
| attachment id (`:attachment`)                  | `^att_[\w-]{1,200}$`                                                                          |
| message                                        | 1 to 16,000 characters                                                                        |
| `POST /exchange` body                          | 4 KiB, counted in bytes                                                                       |
| `POST /settled` body                           | 4 KiB, counted in bytes; `conversation` and `submissionId` 1 to 256 characters                |
| `offset` on `view=updates`                     | `^(?:-1\|\d{1,32}_\d{1,32})$`                                                                 |
| `cursor`, `from`, `before`                     | `^[\w.~=+/-]{1,2048}$`                                                                        |
| thread id (`:thread`, `thread` in a chat body) | `^\d{1,20}$` on an adapter with numeric ids, else `^[\w-]{1,64}$`                             |
| thread title from the agent                    | 120 characters                                                                                |

The plugin sets no rate limits or turn caps (see [limitations.md](./limitations.md)).
