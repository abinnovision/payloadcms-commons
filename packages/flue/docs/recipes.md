# Recipes

The plugin owns who may read which bytes. What a tool reads, how much it reads and what it costs
are the app's policy. This page shows the seams and the example sidecar's tools, which are meant to
be copied. They live in `apps/example-v4-agents/src/tools/`.

## The files collection

Chat files live in an upload collection the app defines, so Payload's own seams apply: its
`upload` options, a storage adapter, fields and hooks. `fluePrivateUploads` builds a private one;
`overrides` merges over it:

```ts
const chatUploads = fluePrivateUploads({
  slug: "chat-uploads",
  mimeTypes: ["image/png", "application/pdf", "text/csv"],
  overrides: {
    upload: { staticDir: "/var/data/chat-uploads" },
    hooks: {
      // Throw an APIError to refuse an upload with your message, such as a size cap.
      beforeOperation: [scanUpload],
    },
  },
});
```

Keep `upload.mimeTypes`, `authorship` and Payload's access control for files; the plugin refuses a
collection without them. A size cap per file is the collection's: Payload's `upload.limits` and a
`beforeOperation` hook that checks `req.file.size`.

### Cleaning up

The plugin deletes nothing. For a collection that holds chat files only, such as one built with
`fluePrivateUploads`, a Payload job can remove old uploads of users that nobody sent, and old
files of archived threads:

```ts
const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

await payload.delete({
  collection: "chat-uploads",
  where: {
    and: [
      { createdBy: { exists: true } },
      { createdAt: { less_than: cutoff } },
      {
        or: [
          { flueThread: { exists: false } },
          { "flueThread.status": { equals: "archived" } },
        ],
      },
    ],
  },
  overrideAccess: true,
});
```

Never run it on a collection that also holds other files, such as a shared `media` collection: an
unbound row there is an ordinary upload, not an unsent chat file.

## Tools for files

The tools list the thread's files with mcpx's `findDocuments` through `payload.callTool`, read them
with `payload.download` and return text wrapped with `untrusted()`. Put `UNTRUSTED_GUIDANCE` in the
agent's instructions. Payload scopes every one of these reads to the thread.

| Recipe      | Tool                      | Does                                                                   |
| ----------- | ------------------------- | ---------------------------------------------------------------------- |
| `files.ts`  | `list_files`, `read_file` | the thread's files, and a page of a text file with `nextOffset`        |
| `sheets.ts` | `read_sheet`              | a page of rows of an xlsx or CSV file (`read-excel-file`, `papaparse`) |
| `pdf.ts`    | `read_pdf_page`           | the text of one page of a PDF (`unpdf`, no rendering)                  |

A refusal by Payload (`FluePayloadError`, for example `not_found` or `too_large`) comes back as the
tool's output, so the model can act on it. Anything else fails the call.

To read a large file in parts, pass `range`:

```ts
const { bytes } = await payload.download({
  collection: file.collection,
  id: file.id,
  range: { start: 0, end: 4 * 1024 * 1024 - 1 },
});
```

Each read takes one grant, so read large chunks.

### Tool state

A budget that spans several tool calls needs state. The recipes keep it in Flue's
`usePersistentState`, which is scoped to the agent instance and writable from a tool's `run`. A
render closure does not span a response, because Flue renders before every model call. The files
recipe counts reads per user turn. `useAgentStart` bumps a turn counter for each delivered message,
and the budget starts over when the counter changes. The limit check runs inside the state updater,
which sees the current value, so parallel tool calls cannot overspend. A state name may be used once
per render, so the agent calls the budget hook once and passes `spend` to the tool hooks.
`usePersistentState` throws in subagents, so budgeted tools belong on a root agent. Each write is a
durable record, so write once per tool call.

### Spreadsheets

An xlsx file is a zip archive and can unpack to far more than its size. Check the uncompressed size
from the archive's directory before parsing when files come from untrusted users, and cap the
file's bytes with `maxBytes`. Dates become ISO strings and pages are capped by rows.

### Vision

Flue's `harness.prompt` takes images, so a tool can ask a vision model about an image file:

```ts
useTool({
  name: "describe_image",
  harness: true,
  input: v.object({ file: v.string(), question: v.string() }),
  run: async ({ data, harness, signal }) => {
    const file = await findFile(payload, data.file);
    const { bytes } = await payload.download({
      collection: "chat-uploads",
      id: file.id,
      maxBytes: 3_750_000,
    });
    const answer = await harness.prompt(data.question, {
      images: [
        { type: "image", data: toBase64(bytes), mimeType: file.mimeType },
      ],
    });

    return { output: untrusted(answer.text) };
  },
});
```

Two caveats apply. The child call keeps all of the agent's tools, and Flue stores the call and its
image in the sidecar. The child conversation persists, so an instruction injected by one image can
stay in its context across later calls of the thread. A steered child call is bounded by the same
thing as the agent itself: the owner's mcpx grants. Keep the budget of such calls low.

## Saving a file into a collection

`save_file` in the example editor reads a thread file with `payload.download` and stores it in an
app collection with `payload.upload`. mcpx caps that save at 25 MB.
