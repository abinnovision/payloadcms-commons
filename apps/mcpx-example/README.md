# mcpx example

A minimal Payload CMS app that mounts
[`@abinnovision/payloadcms-mcpx`](../../packages/mcpx) with a blocks-based
content model: `pages` with a `layout.sections` block graph
(`sectionWrapper` nesting `hero` and `richText` modules), localized `posts`
with a Lexical rich text field, and read-only `tags`. Two locales (`en`,
`de`), drafts on `pages` and `posts`, SQLite storage.

## Setup

```bash
cp .env.example .env
yarn install
yarn workspace @internal/mcpx-example dev
```

The `.env` file is required: Payload refuses to start without `PAYLOAD_SECRET`,
and the MCP API key index derives from it.

Open <http://localhost:3000/admin> and create the first user.

## Create an API key

1. In the admin panel, go to **MCP > API Keys** and create a key.
2. Tick the capabilities the key should have (for example `pages` read and
   write). Capabilities are off by default; a key can never do more than the
   plugin config exposes.
3. Copy the value of the **API Key** field.

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
   at `layout.sections`, naming the block slugs. Append a slug to descend:
   `layout.sections.sectionWrapper`, then
   `layout.sections.sectionWrapper.modules.hero`.
3. `createDocument` with a minimal seed creates a draft and returns the
   publish blockers that remain.
4. `patchDocument` applies RFC 6902 operations to the draft (for example an
   `add` of a `sectionWrapper` block at `/layout/sections/-`). Every write
   lands as a draft and returns the remaining publish blockers.
5. Publish the document in the admin panel. Publishing stays a human action;
   MCP clients cannot publish.
