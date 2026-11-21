# Recipes

The plugin owns who may read which bytes. What a tool reads, how much it reads and what it costs
are the app's policy. This page shows the seams and the example sidecar's tools, which are meant to
be copied. They live in `apps/example-v4-agents/src/tools/`.

## The files collection

Payload's own seams apply to the files collection (see [files](./integration.md#files)).
`overrides` merges over what `fluePrivateUploads` builds:

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

A size cap per file is the collection's: Payload's `upload.limits` and a `beforeOperation` hook
that checks `req.file.size`.

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
tool's output, so the model can act on it. Anything else fails the call. Large files are read by
`range` (see [files in agent code](./integration.md#files-in-agent-code)).

### Tool state

A budget that spans several tool calls needs state that outlives a render, since Flue renders
before every model call. The files recipe keeps a read count per user turn in Flue's
`usePersistentState`: `useAgentStart` bumps a turn counter per delivered message, and the limit
check runs inside the state updater, so parallel tool calls cannot overspend. A state name may be
used once per render, so the agent calls the budget hook once and passes `spend` to the tool hooks.
`usePersistentState` throws in subagents, and each write is a durable record, so keep budgeted
tools on a root agent and write once per tool call.

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
