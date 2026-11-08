# Limitations

## Not included

| Not included                                  | Instead                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Payload REST for agents, `@payloadcms/sdk`    | Agents reach Payload only through mcpx. The plugin mints no session tokens and adds no auth strategy.                                       |
| Programmatic mcpx calls from `usePayload`     | The agent calls mcpx tools through the MCP connection `usePayload` registers.                                                               |
| A `changes` audit on threads                  | mcpx writes are attributed to the key's user by Payload's authorship, not to a thread.                                                      |
| In-chat actions                               | No `proposeValues`, `navigate`, `openDocument`, `showList`, `focusField`, `uiAction` or `useAgentAction`. The agent cannot drive the admin. |
| The edit-view bridge                          | The agent does not see unsaved form state, `formModified` or document locks. It gets the open document's `updatedAt` per turn.              |
| `sidebar.tabs`                                | The panel docks next to the admin and opens from the header or with Ctrl or Cmd plus J.                                                     |
| Confirmable publish                           | `publish` is a plain mcpx grant: an agent with it publishes without approval.                                                               |
| Rate limits and turn caps                     | Limit runs in the sidecar or in front of Payload.                                                                                           |
| Thread sharing                                | A chat thread belongs to its user. Others read only reactive and ambient threads, through `readAgentRuns`.                                  |
| Mapping mcpx writes to `onBehalfOf`           | A reactive run writes as the agent user; `onBehalfOf` is recorded on the thread only.                                                       |
| One agent user per agent                      | All reactive and ambient runs act as the one `agentUser`.                                                                                   |
| `deleteUnattended`                            | Every delete an agent asks for waits for approval by the key's user.                                                                        |
| A public `./protocol` export                  | The wire types are internal. `./agent` re-exports `decodeContext`, `CONTEXT_SIGNAL_TYPE`, `ChatContext` and `ExchangeResponse`.             |
| Flue embedded in the Payload process          | Flue runs as a separate sidecar.                                                                                                            |
| Disabling a managed key from the admin or API | Use the agent's `access`, the user record, Stop, archive or logout (see [security.md](./security.md#revocation)).                           |

## Known gaps

The panel's approval of a confirmation is unverified against a real run. It reads `confirmation`
from an mcpx tool output as the result, its text or the parsed object, but no recording of a Flue
conversation carrying an MCP tool output exists, so the shape Flue sends is assumed. Approval is
offered for `deleteDocument`, mcpx's only confirmable tool.

The status of a thread nobody has open can lag. Settlement reports are best effort and only reach
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
so the run never happens.

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
