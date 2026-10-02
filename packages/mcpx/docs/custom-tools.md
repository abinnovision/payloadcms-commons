# Custom tools

Custom tools use the same `McpxTool` shape as the builtin ones. Pass them in the `tools` option.
Each gets its own checkbox on every API key, unticked by default.

The examples need `zod` v4 installed in the app. It is a dependency of the plugin, not a peer, so
a strict package manager does not expose it.

```ts
import { defineMcpxTool } from "@abinnovision/payloadcms-mcpx";
import { z } from "zod";

export const queueForReview = defineMcpxTool({
  name: "queueForReview",
  description: "Marks a page as ready for editorial review.",
  inputSchema: { id: z.string() },
  handler: async ({ args, req }) => {
    await req.payload.update({
      collection: "pages",
      id: args.id,
      // `reviewRequested` is an illustrative field on the `pages` collection.
      data: { reviewRequested: true },
      overrideAccess: false,
      req,
    });

    return { content: [{ type: "text", text: "queued" }] };
  },
});
```

```ts
mcpxPlugin({
  collections: { pages: { read: true, write: "draft" } },
  tools: [queueForReview],
});
```

## What a handler receives

`handler` receives `args`, `scope`, `req` and `extra`. `req` is the request of the MCP call, with
`req.user` set to the key's user and `req.context.mcpx` holding the key id and its resolved
capabilities. It is the same object as `scope.req`. `extra` is the MCP SDK's request context. The
key id is a `McpxDocumentId`, which is `number | string` because it follows the database adapter.

`scope` describes what the key may touch: the slugs it may read, write and publish, for
`collections` and for `globals` (`readable`, `writable`, `publishable` in each, typed
`McpxScopeSlugs`), the full resolved
`capabilities`, the configured `localization` (`locales` and `defaultLocale`, or `null` when
localization is off), the `limits` in force, and the exposed collections and globals under
`exposure`.

A custom tool is trusted code. Pass `overrideAccess: false` and `req` to every Local API call, as
above: Payload's Local API skips access control by default, and the draft guard only recognises
writes that carry the MCP `req`. [security.md](./security.md#custom-tools-and-custom-auth) lists
what else a custom tool is responsible for.

## Reads

The builtin read tools populate relations only into collections the key can read, and send any
other relation back as its id. A read on `req` does not: it populates into every collection the
user's access allows. Pass `mcpxReadRequest(scope)` as `req` to apply the same bound:

```ts
import {
  defineMcpxTool,
  jsonResult,
  mcpxReadRequest,
} from "@abinnovision/payloadcms-mcpx";

export const listPages = defineMcpxTool({
  name: "listPages",
  description: "Lists pages with their relations populated.",
  inputSchema: {},
  handler: async ({ req, scope }) =>
    jsonResult(
      await req.payload.find({
        collection: "pages",
        depth: 1,
        overrideAccess: false,
        req: mcpxReadRequest(scope),
      }),
    ),
});
```

Use it for reads only; writes keep `req`. It bounds population, not output: neither `req` nor
`mcpxReadRequest(scope)` removes `admin.hidden` fields, so a tool that must withhold them filters
its own output. See [security.md](./security.md#hidden-fields).

## Schemas built per request

`inputSchema` may be a function of the scope instead of a fixed shape. That is how a tool narrows
an enum to what the key may use:

```ts
import { defineMcpxTool } from "@abinnovision/payloadcms-mcpx";
import { z } from "zod";

export const whichCollection = defineMcpxTool({
  name: "whichCollection",
  description: "Echoes back one of the collections this key may read.",
  isEnabled: (scope) =>
    scope.capabilities.tools["whichCollection"] === true &&
    scope.collections.readable.length > 0,
  inputSchema: (scope) => ({
    collection: z.enum(scope.collections.readable as [string, ...string[]]),
  }),
  handler: ({ args }) => ({
    content: [{ type: "text", text: args.collection }],
  }),
});
```

`defineMcpxTool` infers the handler's arguments from the input schema in both forms, so `args`
above is `{ collection: string }`. Inference works from the shape's static type, so a helper that
returns `z.ZodRawShape` leaves `args` as `Record<string, unknown>`. In that case, state the
arguments as a type argument: `defineMcpxTool<Args>({ ... })`.

`description` may also be a function of the scope.

## Enabling a tool

`isEnabled` decides whether the tool is registered for the key. A tool that is not enabled does
not appear in `tools/list`. Without `isEnabled`, the tool's own checkbox decides. Defining
`isEnabled` replaces that check, so include `scope.capabilities.tools[name]` when you still want
the checkbox to count, as above. An `isEnabled` that ignores it exposes the tool to every key.

## Arguments and results

Input schemas are strict for custom tools too; see [concepts.md](./concepts.md#tools).

`jsonResult(value)` and `errorResult(message, extras)` build results in the same format as the
builtin tools. Return `errorResult` for outcomes the client can act on. Thrown errors reach the
client as described in [security.md](./security.md#input-checks).

`isMcpxRequest(req)` tells your own hooks whether a request came through the MCP endpoint.
