# example-v4-agents

The [Flue](https://flueframework.com) sidecar for [`example-v4`](../example-v4).
It serves three agents built on
[`payloadcms-flue`](../../packages/flue)'s `./agent` entry, which reach Payload
only through mcpx as the user a run acts for.

| Agent        | Mounted at           | Does                                        |
| ------------ | -------------------- | ------------------------------------------- |
| `editor`     | `/agents/editor`     | edits all content, saves files and uploads  |
| `reviewer`   | `/agents/reviewer`   | reviews content without changing it         |
| `summarizer` | `/agents/summarizer` | summarises the document a run is started on |

Every route under `/agents/*` answers 401 unless the request carries
`Authorization: Bearer <FLUE_SIDECAR_SECRET>`. `src/app.ts` also calls
`reportSettlements()`, so Payload learns when a run settles even when nobody
has its thread open.

## Setup

```bash
cp .env.example .env
yarn workspace @internal/example-v4-agents dev
```

The sidecar is on http://localhost:3101. `dev` stops with an error when
`PAYLOAD_URL` or `FLUE_SIDECAR_SECRET` is missing. Conversations live in
`.data/flue.db`, set up in `src/db.ts`, and survive restarts. Deleting `.data/`
starts over: Payload's threads of the old conversations then refuse new turns
and ask for a new thread.

To run it next to the Payload app:

```bash
yarn turbo run dev --filter=@internal/example-v4
```

`dev` of example-v4 starts this sidecar alongside, through `with` in its
`turbo.json`.

`build` writes `dist/server.mjs`, and `start` runs it on port 3101 with the
variables from `.env`. The built server uses the same database file.

| Variable              | Required | Purpose                                                           |
| --------------------- | -------- | ----------------------------------------------------------------- |
| `PAYLOAD_URL`         | yes      | Base URL of example-v4.                                           |
| `FLUE_SIDECAR_SECRET` | yes      | Shared with example-v4, at least 32 characters; checked on start. |
| `ANTHROPIC_API_KEY`   | yes      | Key for the default model.                                        |
| `FLUE_MODEL`          | no       | Flue model specifier. Defaults to `anthropic/claude-haiku-5-5`.   |
