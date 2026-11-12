# Concepts

The plugin connects three processes: the admin in the browser, the Payload server and a private
Flue sidecar that runs the agents. Payload owns identity and authority. The sidecar holds no mcpx
key at rest: it trades a per-conversation handle for one when an agent first needs Payload.

## Runs

A run is one conversation with one agent. Each run is a row in the `flue-threads` collection and a
conversation in Flue.

| Kind       | Started by                                         | Acts as        | Thread `createdBy` | `onBehalfOf`        |
| ---------- | -------------------------------------------------- | -------------- | ------------------ | ------------------- |
| `chat`     | a user sending a message in the chat panel         | that user      | that user          | unset               |
| `reactive` | `queueFlueRun`, for example from a collection hook | the agent user | the agent user     | the triggering user |
| `ambient`  | an agent's `ambient.cron` schedule                 | the agent user | the agent user     | unset               |

A chat run is checked against the agent's `access` on every message. Reactive and ambient runs
are server-side and trusted: `access` is not checked. Both run through the `flue-dispatch` job
task, which finds the agent user by `agentUser.email`. The plugin never creates that user; it must
exist before a job runs.

mcpx writes made during a run are attributed to the run's user by Payload's core authorship, not
to the thread. For a reactive run that is the agent user; `onBehalfOf` on the thread records who
triggered it.

## Threads

The `flue-threads` collection (slug `threads.slug`) holds one row per conversation. It sets
`versions: false` and `admin.hidden: true`, and keeps Payload's core authorship, whose `createdBy`
is the owner.

Ownership compares both `createdBy.relationTo` and `createdBy.value` against the signed-in user,
because ids repeat across auth collections. Only users of mcpx's user collection own threads and
chat with agents.

| Field              | Who writes it                                 | Notes                                                            |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------- |
| `agent`            | the plugin                                    | the agent's slug                                                 |
| `title`            | the plugin, the agent, the owner              | first 80 characters of the first message, then the agent         |
| `agentTitle`       | the plugin                                    | the title the agent last wrote; `hidden: true`                   |
| `context`          | the plugin                                    | `collection`, `docId`, `global`, `locale` of the start           |
| `kind`             | the plugin                                    | `chat`, `reactive` or `ambient`                                  |
| `onBehalfOf`       | the plugin                                    | reactive runs only                                               |
| `status`           | the plugin; the owner may only set `archived` | `idle`, `running`, `failed`, `archived`                          |
| `lastMessageAt`    | the plugin                                    | drives the thread order and the unread dot                       |
| `lastReadAt`       | the owner                                     | set by the panel when the owner opens the thread                 |
| `lastSubmissionId` | the plugin                                    | Flue's id of the current turn; hidden in the admin               |
| `flueUid`          | the plugin                                    | the incarnation of the conversation in Flue; hidden in the admin |
| `dispatchJob`      | the plugin                                    | `<job id>@<job createdAt>` of a reactive or ambient run; unique  |
| `conversationId`   | the plugin                                    | `hidden: true`, never returned by the API                        |
| `handleHash`       | the plugin                                    | `hidden: true`, never returned by the API                        |

Access through the API:

- Nobody creates or deletes a thread. The plugin creates rows with `overrideAccess: true`.
- The owner reads and updates their threads, and may change only `title`, `lastReadAt` and
  `status` to `archived`. Any other status change is refused unless the plugin makes it.
- `threads.readAgentRuns(req)` lets a user also read every `reactive` and `ambient` thread. They
  cannot update them. By default nobody but the agent user reads those threads, and only threads a
  user can read are reconciled when opened (see [status and title](#status-and-title)).

Archiving is final from the API. The exchange refuses the handle of an archived thread, and the
archive asks the sidecar to abort the conversation's run whatever the status, which can lag the
run. The archive does not wait for the sidecar's answer, and a conversation Flue has not seen
counts as stopped. Archiving a `running` thread also disables the key of the thread's user and
agent until the next turn. Both are best effort and logged on failure.

## The turn

Each message is one turn, and each turn is exactly one Flue submission: a signal of type
`payload-context` (`CONTEXT_SIGNAL_TYPE`) whose body is the message and whose attributes carry the
context. A turn with attachments takes another shape, described [below](#turns-with-attachments).

| Attribute    | Value                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `route`      | the admin path the message was sent from                                                          |
| `collection` | the collection of a list, create or edit view                                                     |
| `id`         | the document of an edit view                                                                      |
| `global`     | the global of a global view                                                                       |
| `locale`     | the admin locale, or the `locale` search parameter                                                |
| `updatedAt`  | the open document's `updatedAt`, read as the user; left out if unreadable                         |
| `drafts`     | `true` or `false`: whether the open document's collection or global has drafts, set by the server |
| `focus`      | the path of the field the user last focused in the open edit view, such as `blocks.0.title`       |
| `kind`       | `chat`, `reactive` or `ambient`                                                                   |
| `onBehalfOf` | the triggering user's id, reactive runs only                                                      |
| `turn`       | `user`, which marks the signal as the user's turn                                                 |

Unset values are left out. Agent code reads the context with `usePayload().context()`, or with
`contextOf(delivery)` from a delivery of either turn shape. The panel shows a signal marked `turn: user`
as the user's message and hides every other signal.

A turn carries the user's message and its context together, because a signal alone starts a model
run and a second message joining a live run would race the context.

### Turns with attachments

With the `attachments` option on, the panel's composer takes images and PDFs. Only a Flue `user`
message carries files, so a turn with at least one file is sent as one: its body starts with a
preamble Payload writes, a self-closing tag with the same attributes, values XML-escaped, then a
blank line and the user's text as typed.

```
<payload-context route="/admin/collections/posts/12" collection="posts" id="12" locale="en" kind="chat" turn="user"/>

Describe this picture.
```

Text-only turns and runs from jobs stay signals, so a thread can hold both shapes. Only a preamble
at the very start of a `user` message is read; the same tag anywhere else is the user's text.
The panel hides the preamble and shows the files with the message.

Flue keeps the files in the sidecar's store and replays them to the model on every later turn.
The panel loads them through `GET /api/flue/c/:thread/attachments/:attachment`, never from the
sidecar. Payload stores none of them.

A dispatch job that runs again finds its thread through `dispatchJob` and sends nothing. With
`dispatch.wait` on, it waits on the thread's recorded submission (see
[jobs](./integration.md#jobs)).

A turn, in order:

1. Finds the thread (it must be the user's, of the same agent and not archived) or creates one
   with `lastMessageAt` set.
2. Refuses an existing thread without a stored `flueUid` with 409, without a request to the
   sidecar (see [lost conversations](#lost-conversations)).
3. Checks the user's key for the agent and writes it only when it is disabled, has half of
   `keyTtlMs` or less left, or carries other capabilities than the agent's.
4. Posts the signal. A new thread sends `uid: null` and `initialData`, so the send can only
   create the conversation. An existing thread sends its `flueUid`, so the send can only reach
   that conversation.
5. Sets the thread to `running` with the new `lastSubmissionId`, `lastMessageAt` and the `uid`
   Flue answered.

When the sidecar refuses or does not answer, the endpoint answers 502, or 409 for a lost
conversation. An existing thread is set to `failed`. A new thread whose first send Flue refused
with a 4xx is deleted, because Flue created nothing. After a 5xx or no answer, Flue may have taken
the message and its agent may already hold the key, so the thread stays as `failed`: Stop, Archive
and the exchange keep working for it. Every status write is conditional on the thread not being
archived.

The turn never changes the caller's request. Its writes run on a fresh internal request as the
run's user, with `req.context.flue` set (`agent`, `thread`, `kind`, `onBehalfOf`, `internal`).

## The exchange handle and managed keys

When the plugin creates a conversation in Flue, it sends a handle: 32 random bytes, base64url, in
Flue's `initialData` under the key `@abinnovision/payloadcms-flue`. Flue reads `initialData` only
on the request that creates the conversation. Payload keeps only the handle's SHA-256, on the
thread row as `handleHash`.

The conversation id the plugin uses in the sidecar's URLs is a separate random value. It is never
a credential.

The key is a managed mcpx key, one per (user, agent), marked with `managedBy: "flue:<agent>"` and
labelled `Flue: <label>`. Each turn and each dispatch:

- creates the key on first use, or picks the oldest one for the pair;
- leaves it alone when it is enabled, has more than half of `keyTtlMs` left and carries exactly
  the agent's capabilities;
- otherwise enables it, rolls its `expiresAt` to now plus `keyTtlMs` and resets its capabilities
  to the agent's, ticking every mcpx checkbox the agent is granted and clearing all others. An
  edit made to the key in the meantime is undone on the next turn.

A turn therefore leaves the key at least half of `keyTtlMs`. The exchange does not extend it, so a
run that lasts longer than that after its last turn can lose Payload access.

The exchange finds the thread by `handleHash` and the key by the thread's owner and agent. It
answers with the key only when the thread is not archived, is of the agent that asks and belongs to
a user of mcpx's user collection, and the key is enabled, unexpired, that user's and marked for
that agent. For a chat thread the agent's `access` must still admit the owner. All threads of one
user and agent share one key, so the handle of any of their unarchived threads exchanges while that
key is live.

In the sidecar, `usePayload` registers an MCP connection to mcpx whose auth is resolved lazily. The
first request exchanges the handle at `POST /api/flue/exchange` and caches the key in memory. A
401 from mcpx drops the cached key, so the next request exchanges again.

## Status and title

The thread's `status` follows its current submission:

| Status     | Set when                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `running`  | a turn was posted                                                                                             |
| `idle`     | the current submission settled `completed` or `aborted`, or a Stop was confirmed                              |
| `failed`   | the current submission settled `failed`, the sidecar refused the turn, or Flue no longer has the conversation |
| `archived` | the owner archived the thread                                                                                 |

Only a settlement of the row's `lastSubmissionId` changes the status, and only while the row is
`running`, so an old settlement replayed on a reconnect changes nothing.

The plugin learns about settlements in three places, and in a fourth when `dispatch.wait` is on:

- The conversation route reads the updates it proxies to the panel, whether a JSON page, a long
  poll or server-sent events. A settlement sets the status, and a `title` data part sets the
  title, cut to 120 characters. A `conversation-reset` chunk is applied as a history read.
- A history read through the conversation route, which the panel makes when it opens or resumes
  a thread. If the row is `running` and history shows its current submission settled, the status
  is set from it, and the last title the agent wrote is applied unless it equals `agentTitle`.
- The sidecar's settlement report. With `reportSettlements()` in the sidecar's `app.ts`, the
  sidecar posts `{ conversation, submissionId }` to `POST /api/flue/settled` when a submission
  settles. Payload answers 409 while the row has not recorded that submission, so the sidecar
  tries again. Otherwise it reads the conversation's history and applies it as above. The report
  only names the thread; the status and title come from Flue's history.

- A `flue-dispatch` job with [`dispatch.wait`](./integration.md#waiting-for-the-run) on. It reads
  the conversation's history until its submission settles and applies it as above. Without
  `dispatch.wait`, or after its timeout, the job settles nothing.

The report is best effort. Without `reportSettlements()`, for a run started with `flue run`, or
when Payload stays unreachable past the report's retries, a thread keeps `running` until someone
who can read it opens it or the panel's stale-running check reads it (see
[the Threads view](#the-threads-view) and [limitations](./limitations.md#known-gaps)).

The agent sets the title with `useThreadTitle()`, which writes a Flue data part named `title`
(1 to 120 characters). Every title the plugin applies from the agent is also stored in
`agentTitle`, so a rename by the owner stands until the agent writes a different title.

## Lost conversations

The first send of a thread creates its conversation in Flue, and the thread stores the `uid` Flue
answers as `flueUid`. Every later turn sends that `uid`, and Flue takes the message only into that
same conversation. When the sidecar's store no longer has it, for example after the store was
reset, Flue answers 404 `agent_instance_not_found` and writes nothing. The turn then sets the
thread to `failed` and refuses with 409: "The agent sidecar no longer has this conversation. Start
a new thread." A thread without a stored `flueUid` is refused the same way, without a request to
the sidecar.

The plugin never starts a lost conversation again under the same thread; the user starts a new
one. Keep conversations in a persistent store (see
[runtime and store](./integration.md#runtime-and-store)).

## The chat panel

`FlueProvider` is mounted through `admin.components.providers`, so it wraps the whole admin and
stays mounted across navigation. It renders only its children and makes no request until a user of
mcpx's user collection is signed in, because providers also wrap the login view. Signing in as
another user starts from scratch.

For a signed-in user the provider docks the panel as a column to the right of the admin. Both sit
side by side in a flex row, so the admin narrows and Payload's sticky header and document controls
keep working. Dragging the panel's left edge, or the arrow keys on it, resizes it between 320 and
720 pixels. Below 1024 pixels it overlays the admin instead.

`FlueToggle`, in `admin.components.actions`, opens and closes the panel. It renders nothing until
the user has an agent to chat with or may read agent runs, and shows a spinner while the open
thread runs. Ctrl or Cmd plus J does the same; Cmd plus K stays Payload's command palette.

The panel is composed of `@assistant-ui/react` primitives, styled with Payload's design tokens. Its
header holds the agent picker (agents from `GET /api/flue/agents`), a Threads button, New thread
and Close. Below it the panel shows either the open conversation, with its composer and Stop while
a run is going, or the Threads view.

The conversation's title bar shows the thread's title and, for a run, its agent and whether a hook
or a schedule started it. A `failed` thread whose conversation Flue no longer has also shows "The
agent no longer has this conversation. Start a new thread."

- The open thread is observed with `@flue/sdk`: `createFlueClient` on the plugin's conversation
  route and `observe()` with long polling. The observation hydrates from history, follows the
  updates, drops chunks it has applied and hydrates again when the conversation's incarnation
  changes. It starts when a thread opens and closes when another one opens or the panel
  unmounts.
- Messages go through `POST /api/flue/chat/:agent`, never through the SDK. A new thread exists once
  its first message created it. The sent message shows until the conversation carries it.
- assistant-ui reads the conversation through `useExternalStoreRuntime` and the threads through
  `useRemoteThreadListRuntime` over the threads REST API. Archive and delete both archive, rename
  patches the title, and no title is generated, because the agent writes it.
- A user's turn arrives as the context signal marked `turn: user` and shows as the user's message.
  Other signals, advisories, hidden messages and `title` data parts do not show. A failed or
  aborted submission shows as a line saying so.
- The panel stores `{ open, agent, threadId, width }` in the `flue` preference. After a reload it
  reopens the same agent and the same thread, if the thread is not archived and is still the
  agent's chat or a run the user may read.
- On an edit view or a global's view the newest thread about that document or global opens, once
  per document or global and never while a run is going. It does not replace a thread the user
  opened in the panel during the session, and a document without a thread keeps the open one, so
  following a confirmation link to the admin does not lose the conversation.
- A thread the user can read but does not own, such as an agent run under `readAgentRuns`, opens
  read-only: the composer is disabled, and there is no Stop and no Archive.
- The agent's text and reasoning render as Markdown with `@assistant-ui/react-markdown`. Images
  are dropped, raw HTML is skipped and links open in a new tab with
  `rel="noopener noreferrer nofollow"`, because a reply can repeat text from the content the agent
  read. The user's messages show as typed.
- With attachments on, the composer has an add button limited to the configured types, and refuses
  a file over its type's limit. A turn's files show with the user's message: images as
  thumbnails, PDFs as links. A failed send puts the text and the files back in the composer.
- Files an agent uploaded with `usePayload().upload()` show as one card per response, from the
  `data-payload-file` part, with each file's name, type and size and a link to its document.
  A link that does not lead into the admin's collections is left out, and the name shows alone.
- A tool call shows as a collapsed row with its input and output. When `deleteDocument` returns an
  mcpx confirmation, the row asks for approval. Approve and Reject decide the call through mcpx's
  confirmations endpoints as the key's user, then send "Approved. Run the confirmed call." or
  "Rejected." as the next turn. A link to the key's edit view stays as a fallback, and only a URL
  into the admin's collections is linked. A read-only thread shows the link alone and does not
  look the call up.

### Editing the open document

The agent writes the open document only through mcpx, with `patchDocument` and `publishDocument`.
`FlueDocumentBridge`, which the plugin mounts in `admin.components.edit.beforeDocumentControls` of
every collection and global but the threads collection and mcpx's key collection, keeps the edit
view in step:

- Before a turn sent from the edit view, unsaved edits are saved as a draft, as Save draft does,
  so the agent reads what the user sees. A collection or global without drafts would publish them
  instead, so the turn is refused with "Save the document before asking the agent." and the text
  stays in the composer.
- After each successful `patchDocument` or `publishDocument` call on the open document, the form
  loads the document's draft from the REST API, and a live preview of a server-rendered page
  refreshes. Calls that finish while a reload runs cause one more reload after it. Calls of
  submissions that had settled when the conversation loaded are not reloaded. A write that finishes
  before the edit view registers its document reloads it on registering, and a reload under way is
  dropped when the view shows another document or unmounts.
- If the user edited the form while the agent ran, the form still loads the agent's document,
  then puts back each field value the user changed since the form last loaded, so the user's
  edits win. Row ids and block types are not compared. When the agent changed one of those fields
  too, a toast names them: "Your unsaved edits to <paths> replace the agent's changes to them."
- Paths only line up while rows stay in place. If the user added, removed or moved rows of an
  array or blocks field, or the agent changed the rows that hold one of the user's values, the
  form is left as it is and marked stale. A toast that stays open, and a refusal of every later
  turn, say "The agent changed this document while you were editing. Save your edits and reload
  the page before sending." Saving then writes the form over the agent's changes.
- Each agent write adds one to the document's version count, and to its unpublished count unless
  the document is now published.
- The bridge records the field the user last focused, which the turn carries as `focus`.

A document in a drawer, or one the route does not show, is not registered. Agent code can add
`openDocumentGuidance(context)` from `./agent` to its instructions, which tells the model about the
open document, `drafts` and `focus`.

### The Threads view

The Threads button replaces the conversation with a full-height list. Opening a thread, or Escape
with an empty search, brings the conversation back.

- **Chats** lists the user's chats with the selected agent, newest message first, archived ones
  left out. Rows sit under date headings: Today, Yesterday, Previous 7 days, Previous 30 days,
  then one per month. A row shows a spinner while its thread runs, a mark when it failed, and an
  unread dot when `lastMessageAt` is later than `lastReadAt`; each state is also read out as text.
  Archive sits on the row.
- The list pages by keyset on `-lastMessageAt,-id`, 50 rows at a time, so archiving a row never
  shifts a later page. Rows without `lastMessageAt` are left out. The next page loads when the end
  of the list scrolls into view, or with Load more, and a failed page offers Retry. A reload after
  a send or a settled run asks for as many rows as were loaded, up to 500, so loaded pages stay.
- **Search** starts at two characters and matches titles across every agent the user may chat
  with, 20 rows per page. A row of another agent names it, and opening it switches the agent.
- **Runs** is a second tab for users that `threads.readAgentRuns` admits. It lists the reactive
  and ambient threads of every agent, with an agent filter and the same title search, and opens a
  run read-only.
- **Runs-only mode**: a user who may read runs but may chat with no agent gets the toggle and the
  Runs list alone. The agent picker, New thread, the Chats tab and the composer are hidden.

The search field has focus when the view opens. Arrow Down moves into the list, Arrow Up and Down
move between rows, Home and End jump to the first and the last row, and Arrow Right reaches a row's
Archive. Only one row is in the tab order. Escape clears the search first. Arrow Left and Right
switch the tabs.

Every 20 seconds, while the view is open and the page visible, the panel reads the status and
message time of the rows shown as running. A changed chat row reloads the list. A row still
`running` more than two minutes after its last message may have missed its settlement report, so
the panel reads its history through the conversation route, which reconciles the row (see
[status and title](#status-and-title)). It reads at most three such rows at a time, each at most
once every five minutes, after each list load and on each poll.
