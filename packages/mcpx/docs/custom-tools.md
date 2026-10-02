# Custom tools

Custom tools are registered the same way as the builtin ones: one `McpxTool` shape, one
registration loop. Pass them in the `tools` option. Each gets its own checkbox on every API key,
unticked by default.

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
capabilities. It is the same object as `scope.req`. `extra` is the MCP SDK's request context.

`scope` describes what the key may touch: the slugs it may read, write and publish
(`readable`, `writable`, `publishable`, `readableGlobals`, `writableGlobals`,
`publishableGlobals`), the full resolved `capabilities`, the configured `locales` and
`defaultLocale`, the `limits` in force, and the exposed collections and globals under `exposure`.

A custom tool is trusted code. Pass `overrideAccess: false` and `req` to every Local API call, as
above: Payload's Local API skips access control by default, and the draft guard only recognises
writes that carry the MCP `req`. [security.md](./security.md#custom-tools-and-custom-auth) lists
what else a custom tool is responsible for.

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
    scope.readable.length > 0,
  inputSchema: (scope) => ({
    collection: z.enum(scope.readable as [string, ...string[]]),
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

Every input schema is registered as strict, custom tools included: an unknown argument is refused
by name rather than dropped.

`jsonResult(value)` and `errorResult(message, extras)` build results in the same format as the
builtin tools. Return `errorResult` for outcomes the client can act on. A thrown public Payload
`APIError` reaches the client with its message and status, and a Payload `ValidationError` also
carries its field errors. Any other thrown error is logged and reported as "Internal error".

`isMcpxRequest(req)` tells your own hooks whether a request came through the MCP endpoint.
