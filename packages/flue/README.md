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
it, and the sidecar trades a per-conversation handle for an mcpx API key that
Payload creates, rolls and disables.
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
| `@abinnovision/payloadcms-mcpx` | `>=2.1.0 <3`        | the plugin (`.`)                      |
| `@payloadcms/ui`                | `>=4.0.0-beta.7 <5` | the admin chat panel (`./admin`)      |
| `react`                         | `^19`               | the admin chat panel (`./admin`)      |
| `@flue/runtime`                 | `^2.3.0`            | agent code in the sidecar (`./agent`) |
| `valibot`                       | `^1.1.0`            | agent code in the sidecar (`./agent`) |

Every peer is optional, so the sidecar does not install Payload and the Payload
server does not install Flue. The package is ESM only, like Payload.

## Entry points

| Entry     | Runs in            | Exports                                                                                                                                          |
| --------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.`       | the Payload server | `fluePlugin`, `queueFlueRun`, `flueQueues` and the option types                                                                                  |
| `./admin` | the admin browser  | `FlueProvider` and `FlueToggle`, mounted by the plugin                                                                                           |
| `./agent` | the Flue sidecar   | `usePayload`, `useThreadTitle`, `reportSettlements`, `contextOf`, `FlueExchangeError`, `FlueUploadError`, `decodeContext`, `CONTEXT_SIGNAL_TYPE` |

`./admin` needs three browser packages: `@flue/sdk` to follow conversations,
`@assistant-ui/react` for the chat UI and `@assistant-ui/react-markdown` for
the agent's replies. They are regular dependencies, so every install of the
package gets them, but only `./admin` imports them, and the admin loads the
chat's code on its own once a user who can chat is signed in. The sidecar
installs them too, for `./agent`, and never loads them.

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

### Attachments and uploads

Both are opt-in:

| Feature          | Turned on by                                | Does                                                                                     |
| ---------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Chat attachments | `attachments: true` in the plugin's options | users attach PNG, JPEG, GIF, WebP and PDF files to a turn; the model gets them natively  |
| Agent uploads    | `usePayload().upload()` in a tool           | the agent saves a file to an upload collection through mcpx; the chat shows it as a card |

Attachments raise the chat body cap to about 27 MiB at the defaults, and their
files stay in the sidecar's store. Uploads need an upload collection with
`upload.mimeTypes`, `read` and `write` granted on it, and mcpx leases. See
[attachments](./docs/integration.md#attachments) and
[uploads](./docs/integration.md#uploads).

[`docs/integration.md`](./docs/integration.md) covers every option, the
sidecar contract, the endpoints and jobs.
[`apps/example-v4`](../../apps/example-v4) and
[`apps/example-v4-agents`](../../apps/example-v4-agents) run both sides.

## Security

- The sidecar stays private. Payload calls it with the shared secret, and the
  sidecar calls Payload only to exchange a handle and to reach mcpx.
- The exchange handle, the sidecar secret and the plaintext of a managed mcpx
  key never reach the browser.
- One managed key per user and agent. Its user cannot read its plaintext,
  edit it or delete it, and it does not show in the key list.
- Each turn keeps the key enabled with at least half of its lifetime left.
  Stop and archive of a running thread disable it until the next turn, and
  logout disables all of a user's managed keys.
- An agent's `access` decides who may chat with it. It must depend on
  `req.user` only.
- Chat attachments are served only through a Payload route that checks read
  access to the thread. The context preamble of a turn with files is not a
  trust boundary for the model.

Details: [`docs/security.md`](./docs/security.md).

## Documentation

- [`docs/concepts.md`](./docs/concepts.md): runs, threads, the turn, the
  exchange handle and managed keys, status reconciliation, the chat panel.
- [`docs/integration.md`](./docs/integration.md): options, startup
  validation, the sidecar contract, endpoints, jobs, the database, the
  example apps.
- [`docs/security.md`](./docs/security.md): the trust chain, key locks,
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
