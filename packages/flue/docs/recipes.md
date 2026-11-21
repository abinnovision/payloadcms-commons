# Recipes

The plugin owns who may read which bytes. What a tool reads, how much it reads and what it costs
are the app's policy. This page shows the seams and the example sidecar's tools, which are meant to
be copied. They live in `apps/example-v4-agents/src/tools/`.

## Storage and upload hooks

The file workspace is a Payload upload collection, so Payload's own seams apply. `files.overrideCollection`
receives the collection and returns it:

```ts
fluePlugin({
  files: {
    // Exact lower-case types only; spread the default list to extend it.
    // The type the browser reports must be in the list, so a zip may also
    // need "application/x-zip-compressed" (Windows).
    mimeTypes: [...DEFAULT_FILE_MIME_TYPES, "application/zip"],
    overrideCollection: (collection) => ({
      ...collection,
      hooks: {
        ...collection.hooks,
        // Throw an APIError to refuse an upload with your message.
        beforeOperation: [
          scanUpload,
          ...(collection.hooks?.beforeOperation ?? []),
        ],
      },
    }),
  },
});
```

Keep `upload.mimeTypes` and never set `disablePayloadAccessControl`; the plugin refuses a config
that does either. A storage adapter registers its own `upload` options on the collection, the same
way as on any other upload collection. Limits that a deployment tunes, such as `maxBytes`,
`maxFilesPerTurn` and the `pending` limits, are [options](./integration.md#files).

## Tools for files

The tools read through `payload.files` (`list`, `read`, `fetch` with a range) and return text
wrapped with `untrusted()`. Put `UNTRUSTED_GUIDANCE` in the agent's instructions.

| Recipe      | Tool                      | Does                                                                   |
| ----------- | ------------------------- | ---------------------------------------------------------------------- |
| `files.ts`  | `list_files`, `read_file` | the thread's files, and a page of a text file with `nextOffset`        |
| `sheets.ts` | `read_sheet`              | a page of rows of an xlsx or CSV file (`read-excel-file`, `papaparse`) |
| `pdf.ts`    | `read_pdf_page`           | the text of one page of a PDF (`unpdf`, no rendering)                  |

A refusal of the file layer (`FlueFileError`, for example `not_found` or `too_large`) comes back as
the tool's output, so the model can act on it. Anything else fails the call.

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
file's bytes in `files.read`. Dates become ISO strings and pages are capped by rows.

### Vision

Flue's `harness.prompt` takes images, so a tool can ask a vision model about an image file:

```ts
useTool({
  name: "describe_image",
  harness: true,
  input: v.object({ file: v.string(), question: v.string() }),
  run: async ({ data, harness, signal }) => {
    const file = await findFile(payload.files, data.file);
    const bytes = await payload.files.read(file, { maxBytes: 3_750_000 });
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

`save_file` in the example editor reads a thread file with `payload.files.read` and stores it in an
app collection with `payload.upload`. mcpx caps that save at 25 MB.
