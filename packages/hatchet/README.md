# @abinnovision/payloadcms-hatchet

![Jobs queued in Payload are triggered by Hatchet and executed by Payload's own runner on a worker](https://raw.githubusercontent.com/abinnovision/payloadcms-commons/main/packages/hatchet/assets/header.png)

Runs [Payload CMS](https://payloadcms.com/) jobs on [Hatchet](https://hatchet.run).

Payload executes, Hatchet triggers. The `payload-jobs` collection stays the
system of record and Payload's own runner executes every job, with its retries,
backoff and task logs. Hatchet only decides when a job runs and on which worker,
which replaces polling with push, adds durable scheduling and gives each job a
run in the Hatchet dashboard.

> [!NOTE]
> Beta. Releases stay on `0.x` until the API settles, and a minor version may
> include breaking changes. Builds from unreleased changes are published under
> the `beta` npm tag.

## Install

```bash
yarn add @abinnovision/payloadcms-hatchet
```

- Peer dependency: `payload >=3.88.0 <4`.
- The package is published as ESM only, matching Payload itself.

## Plugin

```ts
// payload.config.ts
import { hatchetPlugin } from "@abinnovision/payloadcms-hatchet";
import { buildConfig } from "payload";

export default buildConfig({
  // ...
  jobs: { tasks: [/* ... */] },
  plugins: [hatchetPlugin()],
});
```

Every `payload.jobs.queue()` now hands the job to Hatchet. A job queued inside a
transaction is handed over once the transaction commits, and never if it rolls
back. A job with a future `waitUntil` becomes a Hatchet scheduled run.

| Option              | Type                        | Default                  | Description                                                          |
| ------------------- | --------------------------- | ------------------------ | -------------------------------------------------------------------- |
| `enabled`           | `boolean`                   | `true`                   | With `false`, only the fields are added. See below.                  |
| `client`            | `() => HatchetClient`       | `HatchetClient.init()`   | Creates the client on the first dispatch, never during Payload boot. |
| `taskName`          | `(queue: string) => string` | `` `payload-${queue}` `` | Hatchet task name per Payload queue. Must match the worker's option. |
| `dispatchTimeoutMs` | `number`                    | `2000`                   | Longest wait for each Hatchet call during dispatch.                  |

The default client reads `HATCHET_CLIENT_TOKEN` and the other `HATCHET_CLIENT_*`
variables from the environment.

With `enabled: false` the plugin only adds its fields, so the schema and
migrations stay the same whether Hatchet is used or not. Payload's `autoRun`,
`jobs.access.run` and Local API stay untouched. Mount it always and switch it,
e.g. `hatchetPlugin({ enabled: Boolean(process.env.HATCHET_CLIENT_TOKEN) })`.

A config without tasks or workflows has no jobs collection; the plugin then
installs nothing.

## Worker

The worker is a separate, long-running process. It boots the same Payload config
and registers one Hatchet task per queue:

```ts
// worker.ts
import { createHatchetWorker } from "@abinnovision/payloadcms-hatchet/worker";
import { getPayload } from "payload";

import config from "./payload.config.js";

const payload = await getPayload({ config });
const worker = await createHatchetWorker({
  payload,
  queues: ["default", "mail"],
});

await worker.start();
```

Run it with `tsx worker.ts` or compile it with the rest of the app. It does not
depend on Next.js.

| Option          | Type                                  | Default                  | Description                                                |
| --------------- | ------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `payload`       | `Payload`                             | required                 | A booted Payload instance.                                 |
| `queues`        | `string[]`                            | required                 | Payload queues this worker executes.                       |
| `hatchet`       | `HatchetClient`                       | `HatchetClient.init()`   | Client to register the tasks with.                         |
| `name`          | `string`                              | `"payload"`              | Worker name in Hatchet.                                    |
| `slots`         | `number`                              | Hatchet's default        | Concurrent runs on this worker.                            |
| `handleKill`    | `boolean`                             | `true`                   | Stop and exit the process on SIGTERM and SIGINT.           |
| `taskName`      | `(queue: string) => string`           | `` `payload-${queue}` `` | Must match the plugin's option.                            |
| `maintenance`   | `{ cron?, staleAfterMs? }` or `false` | `*/5 * * * *`, 5 min     | Cron task for Payload schedules and stale jobs. See below. |
| `heartbeatMs`   | `number`                              | `20000`                  | How often a running job refreshes its Hatchet timeout.     |
| `maxDurationMs` | `number`                              | unlimited                | Milliseconds after which a running job is cancelled.       |

The maintenance task runs Payload's `handleSchedules` and sweeps every queue. It
releases jobs left `processing` by a run that stopped heartbeating, and
re-dispatches runnable jobs whose last dispatch is older than `staleAfterMs`,
oldest first and at most 100 per run. A job whose Hatchet run is still queued or
running is left alone and checked again after another `staleAfterMs`. That
covers worker crashes and jobs whose dispatch failed or timed out while Hatchet
was unreachable. Running it on several workers is harmless.

## Running the worker

### Dedicated process

`runHatchetWorker` boots Payload, starts the worker and stops it on SIGTERM or
SIGINT. Running jobs get up to `shutdownTimeoutMs` to finish, then it resolves.
It never exits the process itself.

```ts
// src/worker.ts
import { runHatchetWorker } from "@abinnovision/payloadcms-hatchet/worker";
import config from "@payload-config";

await runHatchetWorker({ config, queues: ["default"] });
```

```bash
payload run src/worker.ts
```

`payload run` exits once the script resolves, so the process exits with code 0
after the drain. `runHatchetWorker` takes the `createHatchetWorker` options
except `payload` and `handleKill`, plus:

| Option              | Type                                                     | Default  | Description                                         |
| ------------------- | -------------------------------------------------------- | -------- | --------------------------------------------------- |
| `config`            | `SanitizedConfig`, its promise, or a function loading it | required | E.g. `config` or `() => import("@payload-config")`. |
| `shutdownTimeoutMs` | `number`                                                 | `30000`  | Longest wait for running jobs after a signal.       |

### Inside Next.js

`registerHatchetWorker` from `/next` runs the same worker inside the Next.js
server, from `instrumentation.ts`:

```ts
// src/instrumentation.ts
import { registerHatchetWorker } from "@abinnovision/payloadcms-hatchet/next";

export const register = async (): Promise<void> => {
  // Keeps the config import out of the edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await registerHatchetWorker({
      config: () => import("@payload-config"),
      queues: ["default"],
      enabled: process.env.HATCHET_IN_PROCESS_WORKER === "true",
    });
  }
};
```

The entry itself is edge-safe and does nothing outside the Node.js runtime, but
the `config` loader is the app's own code, so the app has to guard it.

It takes the `runHatchetWorker` options, with `config` as a loader function,
plus `enabled` (default `true`). It starts one worker per process, which
survives dev reloads, and does not wait for it, so the server starts right
away. Without `HATCHET_CLIENT_TOKEN` and without a `hatchet` client it logs a
warning and starts nothing.

Both scripts need two environment variables:

```json
{
  "scripts": {
    "dev": "NEXT_EXIT_TIMEOUT_MS=35000 NEXT_MANUAL_SIG_HANDLE=true next dev",
    "start": "NEXT_MANUAL_SIG_HANDLE=true next start"
  }
}
```

- `NEXT_MANUAL_SIG_HANDLE=true` stops Next.js from exiting on SIGTERM and
  SIGINT. `registerHatchetWorker` then exits once the running jobs finished or
  `shutdownTimeoutMs` passed, with code 143 or 130. It does so even with
  `enabled: false`, since Next.js no longer exits on its own.
- `NEXT_EXIT_TIMEOUT_MS` is how long `next dev` waits for its server process
  before killing it, 100 ms by default. Set it above `shutdownTimeoutMs`.

Next.js reads both before it loads `.env`, so they have to be set in the script
or the real environment. Without them Next.js exits right away and Hatchet
retries the cut-off job once its heartbeat goes stale.

Bundled by Turbopack, the Hatchet SDK cannot open the worker's listener
("Cannot find module as expression is too dynamic") and the worker never
receives a run. Let Node.js load it:

```js
// next.config.mjs
const nextConfig = {
  serverExternalPackages: ["@hatchet-dev/typescript-sdk"],
};
```

Caveats:

- `NEXT_MANUAL_SIG_HANDLE` is documented for `next start` only, and
  `NEXT_EXIT_TIMEOUT_MS` not at all. Their behaviour under `next dev` may change
  with a Next.js release.
- The exit drops HTTP requests still open at that moment. The server keeps
  accepting requests while the jobs drain.
- Every server instance runs a worker. Scaling the app scales the workers, with
  `slots` runs each.
- On SQLite, run the worker in-process or as a dedicated process, not both:
  SQLite allows a single writer.

### Deployment

| Platform                | Dedicated process                | In-process                                                           |
| ----------------------- | -------------------------------- | -------------------------------------------------------------------- |
| Docker, Kubernetes      | A second container or Deployment | Yes. Set the stop grace period above `shutdownTimeoutMs`.            |
| Railway, Render, Fly.io | A second service                 | Yes. Check the platform's shutdown timeout against the drain.        |
| VPS (systemd, PM2)      | A second unit or process         | Yes. Set the process manager's stop timeout above the drain.         |
| Vercel                  | Required, hosted elsewhere       | No: functions are short-lived and Hatchet v1 has no webhook workers. |

Docker stops a container after 10 seconds and Kubernetes after 30 by default.

## How Payload maps to Hatchet

| Payload                     | Hatchet                                                |
| --------------------------- | ------------------------------------------------------ |
| Queue                       | Task named `payload-<queue>`                           |
| Queued job                  | Run of that task, with the job id as input             |
| `waitUntil` in the future   | Scheduled run at `waitUntil`                           |
| Retry with backoff          | New run scheduled at the `waitUntil` Payload set       |
| `concurrencyKey`            | Concurrency group, one run at a time, queued in order  |
| Task or workflow `schedule` | Maintenance cron calling `handleSchedules`             |
| Job id                      | `payloadJobId` run metadata, `hatchetRunId` on the job |

## Semantics

- Hatchet decides the order, roughly first in, first out. `jobs.processingOrder`
  and the `sequential` option of `runJobs` are ignored. Give jobs a shared
  `concurrencyKey` to run them one after another.
- A worker leaves a job whose task or workflow it does not know pending instead
  of failing it, and maintenance dispatches it again later. The app can deploy
  before the worker.
- Moving a job's `waitUntil` earlier through the Local API dispatches it again.
  Moving it later needs nothing: the early run finds the job not due and books a
  new run.
- Deleting or cancelling a job through the Local API deletes its booked Hatchet
  run. Paths that skip collection hooks, such as `payload.db.deleteMany`, leave
  the booked run in place. It does nothing when it fires.
- With `maxDurationMs`, a job that runs longer is cancelled and its Hatchet run
  fails without a retry, which frees the slot. A job that completed or failed in
  the meantime keeps its result.
- Cancelling a run in the Hatchet dashboard cancels the Payload job. This is
  cooperative: the current task finishes and later tasks do not run. A run that
  timed out in Hatchet does not cancel the job.
- A run only executes the job its input describes: a run whose queue or slug
  does not match the stored job is skipped with a warning.
- A job held by another runner, such as Payload's own, is skipped. If that
  runner leaves it pending, maintenance dispatches it again after
  `staleAfterMs`.

## Migrating from Payload's runner

1. Remove external callers of `/api/payload-jobs/run`, such as Vercel cron
   entries, and other schedulers of `payload.jobs.run()`. The plugin sets
   `jobs.access.run` to deny everyone unless the config already sets it, which
   closes that endpoint and `/api/payload-jobs/handle-schedules`. The Local API
   `payload.jobs.run()` the worker uses overrides access and keeps working.
2. Add the plugin and start a worker. Jobs queued before the plugin are picked up
   by maintenance once they are older than `staleAfterMs`. A job still running
   under the old runner is skipped and dispatched again if it is left pending.

## Requirements and caveats

- Use one Hatchet tenant or namespace per deployment. Task names are not
  namespaced by the package; set `taskName` or `HATCHET_CLIENT_NAMESPACE`.

- A worker process has to be running. Without one, jobs queue up in Hatchet and
  nothing executes them.
- `jobs.autoRun` is removed from the config. Hatchet is the only trigger.
- Payload owns job retries. Hatchet retries a run only after a worker crash, a
  timeout or an infrastructure or database error, and a job that exhausted its
  Payload retries fails its run without a Hatchet retry.
- Hatchet retries a run up to six times after 2, 4, 8, 16, 32 and 60 seconds
  (`min(2^n, 60)`, no initial delay). After a hard worker crash the job stays
  claimed until its heartbeat is older than three `heartbeatMs`, so the early
  retries fail and a later one takes over. The 122 seconds in total cover the
  default 60-second window twice over; with a larger `heartbeatMs`, maintenance releases
  the job instead. A runner error inside a live worker releases the job at once.
- The plugin adds the read-only fields `hatchetRunId`, `hatchetScheduledId`,
  `hatchetDispatchedAt` and `hatchetHeartbeatAt` to `payload-jobs`, shown in the
  sidebar, so SQL adapters need a migration.
- Task and workflow `schedule`s are evaluated on the maintenance cron, every five
  minutes by default. Set `maintenance.cron` for finer schedules.
- A job queued in a transaction is dispatched when the transaction commits, and
  the commit waits for Hatchet to accept it, adding latency of up to
  `dispatchTimeoutMs` per Hatchet call. A timed-out dispatch is logged and
  recovered by maintenance.
- Jobs queued where `onInit` is skipped (`disableOnInit`, `payload migrate` and
  other CLI commands) are not dispatched directly. Maintenance picks them up
  after `staleAfterMs`.
- Payload concurrency keys are global, Hatchet concurrency groups are per queue
  task. Jobs sharing a key across queues are only serialized by Payload's own
  `enableConcurrencyControl`.
- Handlers must not block the event loop for longer than the stale threshold
  (three heartbeats for a retry, `staleAfterMs` for maintenance). A blocked
  heartbeat makes the job look dead and lets another run take it.
- On SQLite, transactions are off unless the adapter is created with
  `sqliteAdapter({ transactionOptions: {} })`. Without them every job is
  dispatched straight away.
- Payload deletes completed jobs by default (`jobs.deleteJobOnComplete`). Set it
  to `false` to keep the `payload-jobs` rows next to the Hatchet runs.
