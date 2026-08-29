# mcpx example

A minimal Payload CMS app that mounts
[`@abinnovision/payloadcms-mcpx`](../../packages/mcpx) against a content model
big enough to exercise the interesting parts of the plugin.

| Entity          | Shape                                                                                  | Exposed as       |
| --------------- | -------------------------------------------------------------------------------------- | ---------------- |
| `pages`         | `/layout/sections` block graph: `sectionWrapper` nesting `hero` and `richText` modules | `write: "live"`  |
| `posts`         | Localized Lexical rich text with a `callout` block and an extended link                | `write: "draft"` |
| `tags`          | One text field                                                                         | read only        |
| `site-settings` | Global with a localized title and a blocks field                                       | `write: "live"`  |

Two locales (`en` and `de`), drafts on everything except `tags`, SQLite
storage. `pages` and `site-settings` are the entities to reach for when trying
out `publishDocument`; `posts` is there to show the other side of the axis,
where MCP writes stay drafts and a human publishes.

## Setup

```bash
cp .env.example .env
yarn install
yarn workspace @internal/mcpx-example dev
```

The `.env` file is required. Payload refuses to start without `PAYLOAD_SECRET`.

| Variable         | Required | Purpose                                                                                              |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `PAYLOAD_SECRET` | yes      | Signs JWTs, and the MCP API key index derives from it. Rotating it orphans keys.                     |
| `DATABASE_URI`   | no       | SQLite file. Defaults to `file:./.data/mcpx.db`.                                                     |
| `PAYLOAD_URL`    | no       | Lets the "Connect a client" tab print an absolute endpoint URL. Defaults to `http://localhost:3000`. |

Open <http://localhost:3000/admin> and create the first user.

## Create an API key

1. In the admin panel, go to **MCP > API Keys** and create a key.
2. Tick the capabilities the key should have, for example `pages` read and
   write. Capabilities are off by default, and a key can never do more than the
   plugin config exposes. `pages` and `site-settings` also carry a `publish`
   checkbox, which only counts alongside `write`.
3. Copy the value of the **API Key** field.
4. Or skip the rest of this file: after saving, the **Connect a client** tab
   holds the snippets below with this key already filled in, each behind a copy
   button.

## Connect an MCP client

The endpoint is `POST http://localhost:3000/api/mcpx` with
`Authorization: Bearer <key>`.

MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

Choose **Streamable HTTP**, enter the URL and add the `Authorization` header.

Claude Code:

```bash
claude mcp add --transport http payload http://localhost:3000/api/mcpx \
  --header "Authorization: Bearer <key>"
```

Claude Desktop (via `mcp-remote`):

```json
{
  "mcpServers": {
    "payload": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:3000/api/mcpx",
        "--header",
        "Authorization: Bearer <key>"
      ]
    }
  }
}
```

## Walkthrough

1. `listCapabilities` shows what the key may do, the locales and the limits.
2. `describeSchema` with `collection: "pages"` lists the root fields and stops
   at `/layout/sections`, naming the block slugs. Append a slug to descend:
   `/layout/sections/sectionWrapper`, then
   `/layout/sections/sectionWrapper/modules/hero`.
3. `createDocument` with a minimal seed creates a draft and returns the
   publish blockers that remain.
4. `patchDocument` applies RFC 6902 operations to the draft (for example an
   `add` of a `sectionWrapper` block at `/layout/sections/-`). Every write
   lands as a draft and returns the remaining publish blockers.
5. `validateDocument` re-runs that check without writing, so you can tell
   whether the draft is ready.
6. `publishDocument` promotes the draft on `pages` or `site-settings`, which
   the key may do once its `publish` checkbox is ticked. Try it on `posts` and
   the tool is not there: `posts` is configured `write: "draft"`, so its drafts
   only ever go live through the admin panel.

Reverting a published document to a draft stays a human action either way.
There is no unpublish tool.
