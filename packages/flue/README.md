# @abinnovision/payloadcms-flue

A [Payload CMS](https://payloadcms.com/) 4 plugin that lets agents built with
[Flue](https://flueframework.com/) work inside a Payload admin. Agents read and
write Payload only through
[`@abinnovision/payloadcms-mcpx`](https://github.com/abinnovision/payloadcms-commons/tree/main/packages/mcpx),
with the capabilities the integrator configures per agent, and Payload access
control applies to the user each run acts as.

Runs come in three kinds:

| Run      | Started by                              | Acts as                                          |
| -------- | --------------------------------------- | ------------------------------------------------ |
| Chat     | a user in the admin chat panel          | that user                                        |
| Reactive | `queueFlueRun`, for example from a hook | the agent user, on behalf of the triggering user |
| Ambient  | a schedule                              | the agent user                                   |

Flue runs as a private sidecar process. Payload proxies the panel's stream to
it, and the sidecar trades a per-conversation handle for a short-lived agent
token, which a Payload auth strategy turns into the thread's user with the
agent's capabilities at mcpx.
[`docs/concepts.md`](./docs/concepts.md) explains the model, and
[`docs/security.md`](./docs/security.md) states what each side can reach.

> [!NOTE]
> Beta, Payload 4 only. Releases stay on `0.x` until the API settles, and a minor
> version may include breaking changes.

## Install

```sh
yarn add @abinnovision/payloadcms-flue
```

| Peer                            | Range               | Needed for                            |
| ------------------------------- | ------------------- | ------------------------------------- |
| `payload`                       | `>=4.0.0-beta.7 <5` | the plugin (`.`)                      |
| `@abinnovision/payloadcms-mcpx` | `>=3.0.0 <4`        | the plugin (`.`)                      |
| `@payloadcms/ui`                | `>=4.0.0-beta.7 <5` | the admin chat panel (`./admin`)      |
| `react`                         | `^19`               | the admin chat panel (`./admin`)      |
| `@flue/runtime`                 | `^2.3.0`            | agent code in the sidecar (`./agent`) |
| `valibot`                       | `^1.1.0`            | agent code in the sidecar (`./agent`) |
| `@flue/sdk`                     | `^2.3.0`            | the admin chat panel (`./admin`)      |
| `@assistant-ui/react`           | `~0.15.32`          | the admin chat panel (`./admin`)      |
| `@assistant-ui/react-markdown`  | `~0.14.24`          | the admin chat panel (`./admin`)      |
| `remark-gfm`                    | `^4.0.1`            | the admin chat panel (`./admin`)      |

Every peer is optional, so the sidecar does not install Payload or the admin UI
and the Payload server does not install Flue. The Payload app installs the four
admin packages itself:

```sh
yarn add @flue/sdk @assistant-ui/react @assistant-ui/react-markdown remark-gfm
```

A missing one fails the admin build with a module-not-found error naming it.
The package is ESM only, like Payload.

## Entry points

| Entry     | Runs in            | Exports                                                                                                                                                    |
| --------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`       | the Payload server | `fluePlugin`, `flueThreadScoped`, `defaultDeliver`, `queueFlueRun`, `flueQueues`, `DISPATCH_TASK` and the option types                                     |
| `./admin` | the admin browser  | `FlueProvider`, `FlueToggle` and `FlueDocumentBridge`, mounted by the plugin                                                                               |
| `./agent` | the Flue sidecar   | `usePayload`, `useThreadTitle`, `reportSettlements`, `contextOf`, `filesOf`, `openDocumentGuidance`, `untrusted`, `UNTRUSTED_GUIDANCE`, `FluePayloadError` |

`./admin` needs four browser packages: `@flue/sdk` to follow conversations,
`@assistant-ui/react` for the chat UI, `@assistant-ui/react-markdown` for the
agent's replies and `remark-gfm` for tables. They are optional peers, and only
`./admin` imports them. The admin loads the chat's code on its own once a user
who can chat is signed in.

## Setup

### Payload

Register the plugin next to mcpx. It runs after mcpx (`order: 200`) and reads
its options:

```ts
// payload.config.ts
import { fluePlugin, flueQueues } from "@abinnovision/payloadcms-flue";
import { mcpxPlugin } from "@abinnovision/payloadcms-mcpx";
import { buildConfig } from "payload";

import type { FluePluginOptions } from "@abinnovision/payloadcms-flue";

const flue: FluePluginOptions = {
  sidecar: {
    url: process.env.FLUE_SIDECAR_URL!,
    secret: process.env.FLUE_SIDECAR_SECRET!, // at least 32 characters
  },
  agents: [
    {
      slug: "editor",
      capabilities: { collections: { pages: { read: true, write: true } } },
    },
  ],
  agentUser: { email: "agent@example.com" }, // for reactive and ambient runs
};

export default buildConfig({
  // ...
  serverURL: process.env.PAYLOAD_URL, // fills Payload's CSRF origin list
  jobs: {
    autoRun: flueQueues(flue).map((queue) => ({ queue, cron: "* * * * *" })),
  },
  plugins: [mcpxPlugin({ collections: { pages: true } }), fluePlugin(flue)],
});
```

An unset or empty `sidecar.url` or `sidecar.secret` fails when Payload starts,
not when the config is built, so a build runs without the environment. Every
other mistake in the options fails when the config is built.

The plugin mounts the chat panel through `admin.components.providers` and a
toggle through `admin.components.actions`, so regenerate the import map:

```sh
payload generate:importmap
```

Signed-in users of mcpx's user collection open the panel with the toggle or
Ctrl or Cmd plus J. Its Threads view lists a user's chats by date with title
search, and agent runs for users that `threads.readAgentRuns` admits. The panel renders the agent's replies as Markdown through
`@assistant-ui/react-markdown`: images in them are not loaded, raw HTML is not
rendered and links open in a new tab.

### Sidecar

The sidecar is a Flue app whose `src/app.ts` checks the shared secret before
any agent route and mounts each agent under its slug:

```ts
// src/app.ts
import { reportSettlements } from "@abinnovision/payloadcms-flue/agent";
import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";

import { Editor } from "./agents/editor.js";

// Tells Payload when a run settles, so threads nobody has open leave running.
reportSettlements();

const app = new Hono();

app.use("/agents/*", bearerAuth({ token: process.env.FLUE_SIDECAR_SECRET! }));
app.route("/agents/editor", createAgentRouter(Editor));

export default app;
```

`bearerAuth` accepts only tokens that match `[A-Za-z0-9._~+/-]+=*`, so a secret
with another character refuses every request. Generate the secret from that
alphabet, or check the header as
[`apps/example-v4-agents/src/app.ts`](../../apps/example-v4-agents/src/app.ts)
does.

```ts
// src/agents/editor.ts
"use agent";

import { usePayload } from "@abinnovision/payloadcms-flue/agent";
import { useModel } from "@flue/runtime";

export function Editor(): string {
  useModel(process.env.FLUE_MODEL!);
  usePayload({ agent: "editor" }); // reads PAYLOAD_URL and FLUE_SIDECAR_SECRET

  return "You help editors work on the content of this site.";
}
```

### Files and uploads

Both are opt-in:

| Feature       | Turned on by                                          | Does                                                                                                        |
| ------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Chat files    | `files: { collection }` and `files: true` on an agent | users send files of an app upload collection; images and small PDFs reach the model, the rest as references |
| Agent uploads | `usePayload().upload()` in a tool                     | the agent saves a file to an upload collection through mcpx; the chat shows it as a card                    |

The collection must keep `authorship` and `upload.mimeTypes`; its access stays
the app's. Agents read files with `payload.download` and see what the
collection lets their user see. Put `flueThreadScoped()` on the collection's
`read` and `delete` access: users see their own uploads and agents only the
current thread's files. Size limits, storage and
cleanup are the collection's. Uploads need an upload collection with
`upload.mimeTypes`, `read` and `write` granted on it, and mcpx leases. See
[files](./docs/integration.md#files) and [uploads](./docs/integration.md#uploads).

#### Breaking for 0.1.0 betas

- The `attachments` option is gone; send files through `files` instead. The
  chat endpoint takes `files: ids[]` and no longer takes base64 attachments.
- `files` names an app collection (`{ collection, maxFilesPerTurn?, deliver? }`)
  and each agent opts in with its own `files`. The plugin no longer creates a
  files collection of its own.
  Agents see what that collection lets their user see; add `flueThreadScoped`
  to its access to keep them to the current thread's files.
- `GET /agents` answers each agent's `files` instead of top-level limits.
- `./agent` throws one `FluePayloadError` with a `code` in place of its three
  error classes. The context decoder, the attachment reader, `payload.files`
  and the default read size are gone; read files with `filesOf` and
  `payload.download`.
- A signal turn's body is the typed text; its files are in attributes.

[`docs/integration.md`](./docs/integration.md) covers every option, the
sidecar contract, the endpoints and jobs.
[`apps/example-v4`](../../apps/example-v4) and
[`apps/example-v4-agents`](../../apps/example-v4-agents) run both sides.

## Security

- The sidecar stays private. Payload calls it with the shared secret, and the
  sidecar calls Payload only to exchange a handle and to reach mcpx.
- The exchange handle, the sidecar secret and agent tokens never reach the
  browser. Payload stores only the SHA-256 of a handle or token.
- A token is bound to one thread and lives at most `tokenTtlMs`, one hour by
  default. Each turn opens the thread's live window for that long; Stop and
  archive close that thread's window, and logout closes all of a user's.
- A token cannot approve its own deletes, chat, refresh into a session or
  create mcpx keys. It authenticates Payload's REST API for trusted agent code
  through `run.fetch`, which must never back a tool the model calls.
- An agent's `access` decides who may chat with it. It must depend on
  `req.user` only.
- Chat attachments are served only through a Payload route that checks read
  access to the thread. The context preamble of a turn with files is not a
  trust boundary for the model.
- A user sends only files they uploaded. An agent reads only the files of its
  current thread: every agent request carries the thread's token, and Payload
  access control narrows the files collection to that thread on every read
  path. File content reaches the model as data, never as instructions.

Details: [`docs/security.md`](./docs/security.md).

## Documentation

- [`docs/concepts.md`](./docs/concepts.md): runs, threads, the turn, the
  exchange handle and agent tokens, status reconciliation, the chat panel.
- [`docs/integration.md`](./docs/integration.md): options, startup
  validation, the sidecar contract, endpoints, jobs, the database, the
  example apps.
- [`docs/recipes.md`](./docs/recipes.md): the files collection, cleanup and
  file tools to copy into an agent.
- [`docs/security.md`](./docs/security.md): the trust chain, agent tokens,
  revocation and the risks an integrator owns.
- [`docs/limitations.md`](./docs/limitations.md): what the plugin does not do
  and the known gaps.
- [`docs/standards.md`](./docs/standards.md): test and comment standards for
  contributors.

## Known issues

`@flue/runtime` 2.3.0 declares `@earendil-works/pi-ai` and
`@earendil-works/pi-agent-core` as `^1.1.0`, but 1.5.0 of both dropped the
`Type` export Flue imports, so `@flue/runtime` fails to load. The sidecar must
pin both to 1.4.0 until Flue fixes its range upstream:

```json
{
  "resolutions": {
    "@earendil-works/pi-agent-core": "1.4.0",
    "@earendil-works/pi-ai": "1.4.0"
  }
}
```

With npm, use `overrides` instead of `resolutions`.

The browser packages are pinned to exact versions, but their own dependencies
are ranges: `@flue/sdk` takes `@durable-streams/client` as `^0.2.6`, and
`@assistant-ui/react` takes `@assistant-ui/core` as `^0.3.32`. Both ranges take
every later patch of a pre-1.0 release, which promises no compatibility. The
panel is tested against `@durable-streams/client` 0.2.7 and
`@assistant-ui/core` 0.3.32; if a fresh install breaks it, pin both the same
way.

## License

Apache-2.0
