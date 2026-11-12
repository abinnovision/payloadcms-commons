# Limitations

## Not included

| Not included                                  | Instead                                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Payload REST for agents, `@payloadcms/sdk`    | Agents reach Payload only through mcpx. The plugin mints no session tokens and adds no auth strategy.                                        |
| Programmatic mcpx calls from `usePayload`     | The agent calls mcpx tools through the MCP connection `usePayload` registers. `upload()` is the one exception.                               |
| A `changes` audit on threads                  | mcpx writes are attributed to the key's user by Payload's authorship, not to a thread.                                                       |
| In-chat actions                               | No `proposeValues`, `navigate`, `openDocument`, `showList`, `focusField`, `uiAction` or `useAgentAction`. The agent cannot drive the admin.  |
| The edit-view bridge                          | The agent does not see unsaved form state, `formModified` or document locks. It gets the open document's `updatedAt` per turn.               |
| `sidebar.tabs`                                | The panel docks next to the admin and opens from the header or with Ctrl or Cmd plus J.                                                      |
| Confirmable publish                           | `publish` is a plain mcpx grant: an agent with it publishes without approval.                                                                |
| Rate limits and turn caps                     | Limit runs in the sidecar or in front of Payload.                                                                                            |
| Thread sharing                                | A chat thread belongs to its user. Others read only reactive and ambient threads, through `readAgentRuns`.                                   |
| Mapping mcpx writes to `onBehalfOf`           | A reactive run writes as the agent user; `onBehalfOf` is recorded on the thread only.                                                        |
| One agent user per agent                      | All reactive and ambient runs act as the one `agentUser`.                                                                                    |
| `deleteUnattended`                            | Every delete an agent asks for waits for approval by the key's user.                                                                         |
| A public `./protocol` export                  | The wire types are internal. `./agent` re-exports `decodeContext`, `contextOf`, `CONTEXT_SIGNAL_TYPE`, `ChatContext` and `ExchangeResponse`. |
| Chat attachments in Payload                   | Files of a chat turn live in the sidecar's store. An agent that should keep one saves it with `upload()`.                                    |
| Attachments on runs from jobs                 | `queueFlueRun` and ambient runs send text and context only.                                                                                  |
| `file` parts from agents                      | Flue lets agents write data parts only. Uploads show as the `data-payload-file` card.                                                        |
| Flue embedded in the Payload process          | Flue runs as a separate sidecar.                                                                                                             |
| Disabling a managed key from the admin or API | Use the agent's `access`, the user record, Stop, archive or logout (see [security.md](./security.md#revocation)).                            |

## Attachments

Flue replays a thread's files to the model on every later turn, so each file adds its tokens to
every turn after it. A file the provider rejects fails every later turn of the thread as well;
start a new thread then. The option's types and image limit keep within Anthropic's limits, but
not every limit can be checked before sending:

- Anthropic: images at most 5 MB as base64 and 8000 pixels on a side, a request at most 32 MB,
  PDFs at most 100 pages.
- PDFs reach the model natively only on Anthropic, Google and Vertex, and OpenAI's Responses API.
  Other providers get a placeholder instead.

Hosts with a smaller request body limit than the [chat cap](./integration.md#attachments), such as
some serverless platforms and proxies, refuse large turns before Payload sees them.

A send that times out after Flue admitted the turn marks the thread failed, and resending it adds
the files to the history a second time.

Flue has no API to delete a conversation, so a thread's files stay in the sidecar's store after
it is archived, together with the conversation.

An upload targeting a collection that cannot take a file is refused by mcpx, so `upload()` throws
and nothing is created (see [uploads](./integration.md#uploads)). Pass only upload collections
that set `upload.mimeTypes` to `upload()`.

Uploads need the sidecar to reach Payload at `payloadUrl`. The handoff names Payload's public
origin, `serverURL` or the request's, and only its path is used.

The upload card's list lives in the sidecar's memory for the response. After a sidecar restart or
a retried response it lists only uploads made afterwards.

## Known gaps

The panel's approval of a confirmation is unverified against a real run. It reads `confirmation`
from an mcpx tool output as the result, its text or the parsed object, but no recording of a Flue
conversation carrying an MCP tool output exists, so the shape Flue sends is assumed. Approval is
offered for `deleteDocument`, mcpx's only confirmable tool.

The status of a thread nobody has open can lag. It still does with `dispatch.wait` off, and after a
wait times out, because the run continues. Settlement reports are best effort and only reach
Payload while the sidecar process that ran the submission is up. A sidecar that does not call
`reportSettlements()`, a run started with `flue run`, which never loads `app.ts`, and a report that
finds Payload unreachable for longer than its retries, about 5 seconds, all leave the thread
`running`. It settles when someone who can read it opens it, or when an open panel lists it more
than two minutes after its last message and reads its history. Without `threads.readAgentRuns`
only the agent user can read reactive and ambient threads. See
[status and title](./concepts.md#status-and-title).

Two first messages of the same user to the same agent, sent at the same moment, can create two
managed keys. Every later turn uses the oldest; the other is never rolled, expires on its own and
is disabled with the rest at logout. The duplicate is harmless.

A turn leaves the key at least half of `keyTtlMs`, and the exchange does not extend it. A run
that continues longer than that after its last turn can lose Payload access.

The exchange has no expiry per thread. The handle of any unarchived thread exchanges while the
user's key for that agent is live, because all threads of one user and agent share that key.

Stop or archive of a running thread disables the key the user shares across all their threads with
that agent, so their other runs of that agent lose access until the next turn.

The panel's search matches thread titles only. Flue offers no search over message content.

A reload of the Chats list keeps at most 500 rows. After a send or a settled run, a user who paged
deeper than that sees the list cut back to 500 rows.

Flue has no API to delete a conversation, and its retention is undocumented. Archiving a thread
ends its exchange but leaves the conversation in the sidecar's store.

A dispatch job that ends between creating its thread and sending, for example in a crash, leaves
an `idle` thread without a conversation. A new run of the job finds that thread and sends nothing,
so the run never happens. With `dispatch.wait` on the job outputs `outcome: null` for it.

A workflow job may hold one `flue-dispatch` step. Its steps share one dispatch key, so a second step
fails with a message saying so instead of returning the first step's thread.

`jobs.cancel` does not interrupt a job that waits for its run. The job keeps its queue tick blocked
until the run settles or `dispatch.wait`'s `maxWaitMs` passes, and its final update is then dropped.

Without `src/db.ts`, Flue's Vite dev server resets its store on a cold start and the built server
keeps conversations in memory. A thread whose conversation the store lost refuses new turns with
409 and asks the user to start a new thread. A thread without a stored `flueUid`, such as one
created before the field existed, refuses new turns the same way.

A lost conversation and a failed run share the failed mark in the thread list. Only the title
bar's hint, shown when the open thread's history is gone, and the 409 message of the next turn
tell them apart.

A new thread whose first send timed out or got a 5xx stays `failed`, even when Flue took the
message and the run went on. Its settlement reports get 409, because the row never recorded the
submission. Stop, Archive and the transcript still work.

Long streams can be cut by hosts that limit response duration, such as serverless platforms. The
panel long-polls, and the SDK resumes from the last offset it applied.

Payload 4.0.0-beta.7 requires Node 24.22.1 or later; the repository's `.tool-versions` pins
24.22.1. Flue 2.3.0 requires Node 22.19.0 or later, so the sidecar can run on an older Node than
Payload.

MongoDB is outside the test matrix. There the `apiKey` lock makes one extra privileged read for
every read of an unmanaged key's plaintext (see [managed key locks](./security.md#managed-key-locks)).

SQL adapters that run migrations need one for the `flue-threads` table and the `managedBy` column
(see [database](./integration.md#database)). mcpx's confirmations need Payload's database KV
adapter.

A collection hook that queues runs on a collection the agent writes to loops unless it skips the
agent user's writes (see [reactive runs](./security.md#reactive-runs)).
