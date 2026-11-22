# Security

What each process can reach, how agent tokens are issued, bounded and revoked, and the risks an
integrator owns.

## Trust chain

```
browser  -- admin session -->    Payload
Payload  -- secret -->           sidecar
sidecar  -- secret + handle -->  Payload  POST /api/flue/exchange, returns an agent token
sidecar  -- agent token -->      Payload  POST /api/mcpx, and REST through run.fetch
sidecar  -- secret -->           Payload  POST /api/flue/settled, reports a settled submission
sidecar  -- grant + token -->    Payload  PUT /api/mcpx/upload, the bytes of usePayload().upload()
```

- The browser talks only to Payload, with its admin session. It never reaches the sidecar.
- Payload calls the sidecar with `Authorization: Bearer <sidecar.secret>` and headers it builds
  itself. Cookies and other browser headers are never forwarded.
- The sidecar calls Payload in three ways: the exchange, authenticated by the same secret plus
  the handle of an unarchived thread with an open live window; mcpx and REST, authenticated by the
  token the exchange returned; and settlement reports, authenticated by the secret.
- mcpx applies the agent's capabilities, capped by mcpx's config, and Payload access control as
  the thread's user.

The sidecar has no authentication of its own beyond the secret check in its `app.ts` (see
[integration.md](./integration.md#the-sidecar)). Keep it on a private network. Its only
long-lived credential is the secret, and the secret alone yields no token: the exchange also
needs the handle of an unarchived thread whose live window is open. With the secret alone, the
settled endpoint only makes Payload
read a thread's history from the sidecar, and only for a conversation id and submission the thread
already recorded. It never sets a status or title from the caller's input.

## Where secrets live

| Secret              | Lives in                                                 | Stored as                      |
| ------------------- | -------------------------------------------------------- | ------------------------------ |
| `sidecar.secret`    | Payload's and the sidecar's environment                  | plaintext in both environments |
| exchange handle     | Flue's `initialData` of the conversation, in the sidecar | SHA-256 on the thread row      |
| agent token         | Payload's database KV; the sidecar's memory during a run | SHA-256 in the KV row          |
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
- Agent tokens. Only the exchange answers one, to the sidecar.
- Model provider keys, which only the sidecar has.

Every JSON response of the plugin, the exchange included, carries `Cache-Control: no-store`, and
the updates stream `no-store, no-transform`. The plugin never logs a token, a handle or the secret,
and `SidecarError` messages never include the sidecar's response body.

## Agent tokens

The plugin registers a `flue-token`
[auth strategy](https://payloadcms.com/docs/authentication/custom-strategies) on mcpx's user
collection. It replaces mcpx API keys for agents: flue creates no rows in mcpx's key collection.

- **Format.** `flue_` followed by 43 base64url characters, 32 random bytes. The exchange mints a
  fresh one on every call.
- **Storage.** Payload's database KV holds `flue-token:<sha256>` with the user, the thread, the
  agent, the run kind, the window's generation and the expiry. The plaintext exists only in the
  exchange's answer and the sidecar's memory. Startup fails without the database KV adapter, which
  is Payload's default `kv`.
- **Live window.** Each turn upserts `flue-live:<userId>:<threadId>` with an expiry of now plus
  `tokenTtlMs`. A window opened after it was closed or expired gets a new random generation, and
  every token stores the generation it was minted under. The exchange refuses a thread without an
  open window, a token never outlives the window it was minted under, and every request a token
  authenticates checks that the window is open and still of the token's generation. A token of a
  stopped or logged-out window therefore stays refused after the next turn opens a new one.
- **Thread binding.** The strategy hands mcpx the principal `flue-thread:<threadId>`. mcpx binds
  confirmations and upload grants to it and to the thread's user, so a token of one thread cannot
  run or claim another thread's calls, and an approved call survives the token being exchanged
  again. `flueThreadScoped` reads the thread from the token too.
- **Capabilities.** Read from the live agent config on every request, never from the KV row, and
  capped by mcpx's config. A config change applies at once. `deleteUnattended` cannot be granted.
- **Access.** For a chat thread, every request runs the agent's `access` again for the thread's
  user, as the exchange does, so a user the rule no longer admits loses their tokens at once.
- **Header only.** The strategy reads `Authorization: Bearer flue_…` and nothing else. Any other
  header is ignored without a database read. Each token request reads the token row, the window and
  the user. A user who was deleted, is unverified or is locked out is refused.
- **Refusals.** The flue session endpoints (agents, chat, conversation, abort) answer 403, the
  refresh operation refuses to turn the token into a JWT, mcpx's confirmations endpoint refuses to
  list or decide, and mcpx's key collection refuses every create, read, update and delete.
  `GET /me` answers with the token's expiry.

### The token is a full user session over REST

What mcpx enforces binds the model, which reaches Payload only through mcpx's tools: the agent's
capabilities, approval of every delete, the draft guard and `publish: false`. None of it binds the
token itself. Over Payload's REST and GraphQL APIs a token is a full session of the thread's user,
held only by Payload access control. Code holding it can, wherever that access allows:

- delete documents without any approval;
- publish, or write past the draft guard;
- change the user's password or email;
- enable a Payload API key on the user, which yields a credential that survives Stop, archive,
  logout and the token's expiry, or obtain a cookie session through a changed password, which can
  then approve the agent's own deletes;
- log the user out of every session.

The plugin blocks only the refresh operation, so a token cannot be turned into a JWT directly; the
refusals listed above are no barrier against a holder that uses these paths. The token must
therefore stay in trusted agent code. `run.fetch` from `usePayload` gives that code REST access
without handing the token out, and it must never back a tool the model calls, nor may any HTTP
request carrying the token. Keep agent code reviewed, keep TLS between the sidecar and Payload,
and give the model mcpx tools only.

## Revocation

| Lever                                 | Effect                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Stop                                  | Aborts the run and closes the thread's window; its tokens stay refused for good.         |
| Archive                               | Closes the thread's window and aborts its run; the exchange refuses the handle for good. |
| Logout                                | Closes every window of the user, including those of runs started from other sessions.    |
| The user record                       | The strategy refuses a token whose user was deleted, is unverified or is locked out.     |
| The agent leaves the config           | The strategy and the exchange refuse its tokens and threads.                             |
| The agent's `access` refuses the user | No new chat turns (403), and chat tokens and exchanges of that user are refused.         |
| Expiry                                | A window closes `tokenTtlMs` after the thread's last turn, and its tokens with it.       |

Closing a window takes effect on the next request: tokens of that thread answer 401 and the
exchange answers 404 until a turn opens a new window, whose tokens are new as well. The user's
other threads keep working. Logout and archive close windows inside their transaction, so a failed
revoke fails the logout or the archive, and a logout that rolls back keeps the windows.

None of these levers reaches a credential that token holder code created over REST, such as an
API key it enabled or a password it changed (see above).

## Agent access

An agent's `access` is evaluated by `GET /agents`, by `POST /chat/:agent`, by the exchange for
chat threads and by the strategy on every request of a chat token. The exchange and the strategy
run it on a request built for the thread's user with `createPayloadRequest`, loaded at the user
collection's `auth.depth`. That request carries no headers, cookies or session. A rule that reads
anything but `req.user`, such as a header or an IP address, gives a different answer there, and a
rule that throws fails the exchange and refuses the token.

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

mcpx makes every delete wait for the user it was made for to approve it. mcpx stores the call
under the thread's principal and the acting user, and only that user, in a session without agent
capabilities, may decide it. For a chat run that user is the person chatting. The panel's tool row
offers Approve and Reject, which decide the call through mcpx's confirmations endpoints with the
thread's principal. A token gets 403 there, so an agent cannot approve its own calls. A
confirmation that carries a URL, as a key's does, also gets a review link, kept only when it leads
into the admin's collections, so it never leaves the admin's origin.

For reactive and ambient runs the acting user is the agent user, whom nobody signs in as. Their
delete requests have no human approver and expire after mcpx's 15 minutes unless someone signs in
as the agent user to decide them. The plugin warns at startup for an ambient agent that may
delete; a reactive run of an agent with `delete` gets no warning.

## Attachments

Flue keeps the attachments of a turn in its store. The panel reads them:

- **Access.** The panel reads a file only through `GET /c/:thread/attachments/:attachment`, which
  reads the thread as the user, as the conversation route does. A user who cannot read the thread
  gets 404 and nothing is requested from the sidecar.
- **Storage.** Attachments live in the Flue sidecar's store as well as in the files collection,
  and stay there as long as the conversation (see [limitations](./limitations.md#attachments)).
- **Headers.** Flue's `Content-Security-Policy: sandbox` and the plugin's `nosniff` pass through,
  and every file that is not an image is served as a download, so no attachment runs as active
  content on the admin's origin.
- **Browser cache.** Flue answers `Cache-Control: private, max-age=31536000, immutable`. A file
  stays in the browser's cache after logout, so on a shared machine the next person at the browser
  can still open it from the cache.
- **Cookies.** Thumbnails load with an `<img>` tag, which sends the session cookie only to the
  same site. A panel served from another site than Payload needs `SameSite=None` cookies to show
  them.

The preamble of a turn with attachments is not a trust boundary. Payload writes it and agent code
reads only the preamble at the start of the body, so `contextOf` and `filesOf` cannot be forged.
The model, however, reads the whole body: a user can still type a `<payload-context .../>` tag
into their text and mislead the model with it. Never treat the context, or anything the model
concludes from it, as authorization; the agent's capabilities and Payload access control decide what
a run may
do.

## Files

[Chat files](./integration.md#files) are off by default. Once `files` names a collection:

- **Binding.** A turn binds only files the user created (Payload's `createdBy`, compared by
  collection and id) that belong to no thread or to the turn's thread. It checks them as the user
  and writes the binding past access control on the same condition, so a user cannot bind a file
  of another user, even one they may read, or move a file from another thread. `flueThread` is
  writable by the plugin only: a value a client sends on create or update is dropped.
- **Default scope.** The plugin changes no access on the files collection. An agent acts as its
  user, so without `flueThreadScoped` it reads every file the collection lets the user read,
  across all of the user's threads.
- **Thread scope.** `flueThreadScoped(access?)` is opt-in access for the files collection.
  Without `access` it admits the files the requesting user created, compared by collection and
  id, for users of mcpx's user collection only, and refuses everything when the plugin is not
  installed. A request authenticated by an agent token, over mcpx or REST, gets the wrapped result
  narrowed to the token's thread, as a query on `flueThread`. On another collection than
  `files.collection` it refuses agent tokens. On `access.read` it also covers versions, which
  inherit read access unless the collection sets its own `readVersions`; wrap that too.
- **Every read path.** The helper is Payload access control, so it applies to `findDocuments`,
  `getDocument`, `findVersions` and the file route itself: Payload checks file access before any
  storage handler streams the file. mcpx also refuses a download grant fetched without the
  thread's token (403), and the grant stays claimable.
- **Writes.** Put the helper on `update` and `delete` too where agents are granted `write` or
  `delete` on the collection. It does not belong on `create`, which has no document to narrow. A
  request without an
  agent token, such as the admin's, an mcpx API key's or the in-process mcpx client's, gets the
  wrapped result unchanged.
- **Agent uploads.** A file an agent creates is stored but belongs to no thread, so a
  thread-scoped collection does not show it to the agent.
- **File serving.** Access control applies only where Payload serves the file. A storage adapter
  configured to serve files straight from the bucket, a bucket with a public ACL or a custom
  `generateFileURL` bypasses Payload's access control, and the plugin cannot detect
  them; never configure the chat collection that way and keep its bucket private. The panel never
  links to a file's `url`.
- **Thread ids are visible.** `flueThread` is readable like any other field, so whoever may read a
  file also sees which thread it belongs to, but not the thread itself.
- **Stored names.** Payload keeps filenames unique per collection and renames a clash to
  `name-1.ext`, so an uploader can tell that a file of that name exists, not read it. See
  [random stored names](./recipes.md#hardening-random-stored-names) to hide that too.
- **Logs.** The token travels in the `Authorization` header of the agent's MCP, REST and transfer
  requests. Redact it in proxy and APM logs.
- **File content is data.** A file is content from a user, who may try to steer the model with
  it. A tool that returns file content wraps it with `untrusted()` from `./agent`, and the agent's
  instructions add `UNTRUSTED_GUIDANCE`. The [recipes](./recipes.md) show the pattern, including
  the caveats of vision calls.
- **Archive.** Archiving leaves files bound and, with `flueThreadScoped`, stops the agent's
  reads. Copies Flue made, the
  attachments and images sent to a child call, stay in the sidecar's store (see
  [limitations](./limitations.md#files)).

### Upload grants

`createDocument` returns a single-use upload grant, valid for five minutes, in the
`x-mcpx-grant` header of the handoff. `upload()` uses it for one PUT, sent with the thread's token,
and drops it. mcpx refuses the PUT without the same thread's token and keeps the grant claimable.
The grant never appears in an error message, a log line, the tool output or the
`data-payload-file` part. The document is created as the thread's user, so Payload access control
applies as for any other write. The agent and Payload must be upgraded together, since an older
agent sends no token with the PUT.

## CSRF and CORS

The panel calls the plugin's endpoints, the threads REST API and mcpx's confirmations endpoints
(`GET` and `POST /api/mcpx/confirmations` by default) with the admin's session cookie.
Payload accepts that cookie from a cross-origin request when its CSRF origin list is empty, and
the list is empty unless `serverURL` or `csrf` is set. Set `serverURL`, which Payload adds to the
list.

`POST /chat/:agent` and `POST /c/:thread/abort` require `content-type: application/json`, which a
cross-origin browser request can only send after a CORS preflight. `POST /exchange` and
`POST /settled` ignore the session altogether. Agent tokens are read only from the
`Authorization` header, never from a cookie, so they add no CSRF surface. The plugin's only CORS
header is `Access-Control-Expose-Headers` on the
conversation route, which lets a client that Payload's `cors` option admits read the stream
headers. Payload's `cors` option applies to its endpoints as to any other.

## Limits

| Limit                                          | Value                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `POST /chat/:agent` body                       | 64 KiB, counted in bytes                                                       |
| attachment id (`:attachment`)                  | `^att_[\w-]{1,200}$`                                                           |
| message                                        | 1 to 16,000 characters                                                         |
| `POST /exchange` body                          | 4 KiB, counted in bytes                                                        |
| `POST /settled` body                           | 4 KiB, counted in bytes; `conversation` and `submissionId` 1 to 256 characters |
| `offset` on `view=updates`                     | `^(?:-1\|\d{1,32}_\d{1,32})$`                                                  |
| `cursor`, `from`, `before`                     | `^[\w.~=+/-]{1,2048}$`                                                         |
| thread id (`:thread`, `thread` in a chat body) | `^\d{1,20}$` on an adapter with numeric ids, else `^[\w-]{1,64}$`              |
| thread title from the agent                    | 120 characters                                                                 |

The plugin sets no rate limits or turn caps (see [limitations.md](./limitations.md)).
