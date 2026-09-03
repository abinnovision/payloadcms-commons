# @abinnovision/payloadcms-mcpx

A Payload CMS plugin that mounts an MCP (Model Context Protocol) server over the
content model. The tool surface stays fixed at eight tools plus your own,
whatever the size of that model.

- Field shapes are pulled on demand through `describeSchema`, one node at a
  time, rather than inlined into tool signatures. Adding a collection changes an
  enum, never the tool list.
- Writes are RFC 6902 patches resolved server-side against the real config and
  the real document. An unknown field, a misplaced block or an unusable rich
  text node comes back refused, with the valid alternatives listed.
- Every write lands as a draft unless the config says otherwise, and reports the
  publish blockers still standing between that draft and a publish.
- Capabilities are declared twice. The plugin config decides what can exist, a
  checkbox on each API key decides what does, and a missing checkbox reads as no.

## Install

```bash
yarn add @abinnovision/payloadcms-mcpx
```

- Peer dependency: `payload >=3.88.0 <4`.
- `@payloadcms/ui` and `react` are optional peers, needed only by the admin
  setup guide. A headless install can leave them out and set
  `apiKeys.setupGuide: false`.
- The package is published as ESM only, matching Payload itself.

## Usage

Name the collections and globals the plugin may reach. Nothing outside this list
is exposed:

```ts
import { mcpxPlugin } from "@abinnovision/payloadcms-mcpx";
import { buildConfig } from "payload";

export default buildConfig({
  // ...
  plugins: [
    mcpxPlugin({
      collections: {
        pages: { read: true, write: "live" }, // may be published through MCP
        posts: { read: true, write: "draft" }, // drafts only
        tags: true, // shorthand for { read: true }
      },
      globals: {
        "site-settings": { read: true, write: "live" },
      },
      limits: { maxLimit: 25, maxDepth: 1 },
    }),
  ],
});
```

The plugin adds:

- a `POST /api/mcpx` endpoint speaking MCP over streamable HTTP (stateless, JSON
  responses; `GET` and `DELETE` answer 405),
- an `mcpx-api-keys` collection under the admin group "MCP", holding the keys
  and their capability checkboxes,
- a draft guard on every collection and global, so any write carrying the MCP
  request marker lands as a draft, custom tools included.

Create a key in the admin panel under MCP > API Keys, tick the capabilities it
should have, and copy the plaintext key shown after saving. Checkboxes default
to off, so a fresh key can do nothing until you say otherwise. See
[API keys](#api-keys) for what a key is and is not.

Then point a client at the endpoint, passing the key as a bearer token:

```bash
npx @modelcontextprotocol/inspector
# transport: Streamable HTTP, URL: http://localhost:3000/api/mcpx
# header: Authorization: Bearer <key>
```

Claude Code:

```bash
claude mcp add --transport http payload http://localhost:3000/api/mcpx \
	--header "Authorization: Bearer <key>"
```

Claude Desktop has no direct HTTP header support, so it goes through
`mcp-remote`:

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

## Options

| Option                       | Type                                        | Default                                   | Description                                                       |
| ---------------------------- | ------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `collections`                | `Record<slug, options \| true>`             | required                                  | Allow-list. `true` means `{ read: true }`.                        |
| `collections.<slug>.read`    | `boolean`                                   | `true`                                    | Expose `describeSchema`, `findDocuments`, `getDocument`.          |
| `collections.<slug>.write`   | `"draft" \| "live" \| false`                | `false`                                   | How far writes reach. See below.                                  |
| `globals`                    | `Record<slug, options \| true>`             | `{}`                                      | Allow-list of globals. `true` means `{ read: true }`.             |
| `globals.<slug>.read`        | `boolean`                                   | `true`                                    | Expose `describeSchema`, `getDocument`.                           |
| `globals.<slug>.write`       | `"draft" \| "live" \| false`                | `false`                                   | How far writes reach. See below.                                  |
| `userCollection`             | `string`                                    | `config.admin.user`, then `users`         | Auth collection the keys act as.                                  |
| `apiKeys.slug`               | `string`                                    | `mcpx-api-keys`                           | Slug of the generated key collection.                             |
| `apiKeys.setupGuide`         | `boolean`                                   | `true`                                    | Add a "Connect a client" tab to saved keys. Needs the import map. |
| `apiKeys.overrideCollection` | `(c: CollectionConfig) => CollectionConfig` | —                                         | Final override applied to the generated collection.               |
| `endpoint.path`              | `string`                                    | `/mcpx`                                   | Endpoint path below the API route.                                |
| `limits.maxLimit`            | `number`                                    | `25`                                      | Upper bound for `findDocuments.limit`.                            |
| `limits.maxDepth`            | `number`                                    | `1`                                       | Upper bound for `depth` on reads.                                 |
| `tools`                      | `McpxTool[]`                                | `[]`                                      | Custom tools, defined the same way as the builtins.               |
| `auth.resolve`               | `(args) => Promise<McpxAuthResult \| null>` | —                                         | Replace or wrap the default key resolution.                       |
| `serverInfo`                 | `{ name?, version? }`                       | `payloadcms-mcpx` and the package version | Reported to MCP clients.                                          |

### Write modes

`write` is one axis: how far MCP writes to this entity reach.

| `write`   | With `versions.drafts`                                  | Without                                        |
| --------- | ------------------------------------------------------- | ---------------------------------------------- |
| `false`   | no write tool reaches it                                | no write tool reaches it                       |
| `"draft"` | writes land as drafts, nothing is ever published        | refused at startup: there is no draft to write |
| `"live"`  | writes land as drafts, and `publishDocument` is exposed | writes land on the live document               |

`"live"` is the only way an MCP write reaches live content, whichever of the two
shapes it takes. Wherever it is set, the server instructions and the
`patchDocument` and `createDocument` descriptions name those slugs for the key in
question, so a client is never told its writes are drafts while they are not.

### Upload collections

An upload collection may be exposed for write. `patchDocument` and
`validateDocument` reach it, and `publishDocument` under the same `write:
"live"` rule as anywhere else, so an agent can edit the fields the collection
declares itself, such as `alt` or a credit.

Its base fields (`filename`, `url`, `filesize`, `sizes`, the focal point) are
neither described nor writable. `createDocument` leaves the slug out of its
`collection` enum and says why in its description: a create there would have to
carry the file, and no tool does. Upload the file in the admin panel first.

### Startup validation

Misconfiguration fails at startup with `InvalidConfiguration`: unknown slugs,
`write: "draft"` on a collection without drafts, `write` on a collection with
`timestamps: false`, tool name collisions, and `write: "live"` on an entity
using `versions.drafts.localizeStatus`, which is not supported yet.

Auth collections cannot be exposed at all, read included. Their documents carry
credentials, such as the decrypted Payload API key of every user.

## Tools

`tools/list` reflects the key: write tools disappear for read-only keys, and
every `collection` and `global` enum contains only the slugs the key may touch.
Builtin tools reject unknown arguments by name instead of silently ignoring
them.

| Tool               | Purpose                                                                  | Key arguments                                                                                |
| ------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `listCapabilities` | What this key may do, `create` apart from `write`; call first to orient. | none                                                                                         |
| `describeSchema`   | Field shape of one node; `next` lists the drill-down paths.              | `collection` \| `global`, `paths?`, `expand?`                                                |
| `findDocuments`    | Query documents.                                                         | `collection`, `where?`, `sort?`, `limit?`, `page?`, `depth?`, `select?`, `locale?`, `draft?` |
| `getDocument`      | Read one document or a subtree of it.                                    | `collection` + `id` \| `global`, `path?`, `depth?`, `locale?`, `draft?`, `outline?`          |
| `patchDocument`    | Apply RFC 6902 operations to the current draft.                          | `collection` + `id` \| `global`, `locale`, `patches`, `expectedUpdatedAt?`                   |
| `createDocument`   | Create a draft from a minimal seed. Not for upload collections.          | `collection`, `locale`, `data`                                                               |
| `validateDocument` | Publish blockers without saving anything.                                | `collection` + `id` \| `global`, `locale`                                                    |
| `publishDocument`  | Publish the current draft.                                               | `collection` + `id` \| `global`, `expectedUpdatedAt?`                                        |

### Paths and pointers

Every path this plugin accepts or reports is a JSON Pointer. A schema path and a
pointer into a document differ only in what stands in an element position: a
schema path writes `*` for an array element and names a block by its slug, where
a pointer carries a 0-based index. So `/items/*/title` is written at
`/items/0/title`, and `/layout/sections/hero` at `/layout/sections/0`.

Inside a rich text field that substitution does not apply, because an editor
state is a tree rather than a list per type. A path there names the node type,
and a block node its slug. A pointer enters the state at `root` and walks
`children` by an index counted over every child at that level, with the node's
own fields under `fields`. So the path `/content/block/practice-note/variant` is
written at the pointer `/content/root/children/7/fields/variant`, and only the
stored state says which index that is. `getDocument` with `outline` answers
that.

### Reading the schema

- Paths stop at blocks fields, which list the block slugs they accept. Every
  node carries `next`, the ready-to-use paths for those blocks
  (`/layout/sections/sectionWrapper`), so pass an entry of `next` as a `paths`
  element to descend. A block is described as it exists at that position.
- A field marked `admin.hidden` is neither described nor writable. Payload keeps
  such a field out of the admin panel only, where this plugin keeps it from the
  client as well.
- Constraints a field declares travel with it: `minRows` and `maxRows` on arrays
  and blocks fields, `maxLength` and `minLength` on text, `min` and `max` on
  numbers. An array is described in its own right, so the `*` in `/items/*/title`
  has something to read. A group or named tab is described only when it declares
  a description or a constraint of its own.
- Field and collection `admin.description` values reach `describeSchema` and
  `listCapabilities`, so intent written for the admin panel reaches the client. A
  locale-keyed record resolves to one string for the request's language, falling
  back to the deployment's fallback language and then to the record's first
  entry. Functions and components are dropped.

### Patching

- Adding a block requires `blockType` on the value. Append with `/-`.
- Clearing is `replace` with `null`. A list is emptied with `[]` and refuses
  `null`. `remove` is only valid on list elements, because Payload keeps fields
  absent from a write.
- Nothing in a patch batch is applied unless every operation validates first.
- Pass the `updatedAt` you read as `expectedUpdatedAt` so a concurrent edit is
  refused instead of overwritten.
- Fields Payload maintains (`id`, `_status`, `createdAt`, `updatedAt`,
  `deletedAt`) are never listed and never writable. `readOnly` fields are listed
  but refused on write.

### Rich text

A `richText` field lists the Lexical node types it accepts in `nodes`, and
`next` carries a path for every node type that holds fields of its own:
`/content/link` for a link node, `/content/block/callout` and
`/content/inlineBlock/badge` for the block nodes. Descending returns the real
field list. `upload` nodes are the exception, since their fields depend on the
collection the node points at, so they are not addressable.

A field also reports `nodeOptions`, the node properties its editor narrows. An
editor built with `HeadingFeature({ enabledHeadingSizes: ["h4"] })` answers
`{ "heading": { "tag": ["h4"] } }`, and a write carrying any other heading tag is
refused. Lexical stores whatever tag it is given, so this is the only place the
restriction is checked.

A node must be written the way Lexical serializes it, carrying the values
Lexical would have written. Payload does not check that on write, so this plugin
does, and the refusal names the property and what belongs there. A
`describeSchema` response that reached a `richText` field ends with a
`nodeProperties` entry stating what each node type has to carry, keyed by node
type and in the same words the refusal uses. Its `text` entry reads:

```json
{
  "detail": "a number",
  "format": "a number",
  "mode": "a string",
  "style": "a string",
  "text": "a string",
  "type": "a string",
  "version": "a number"
}
```

A field's value is addressable, so a small edit does not have to rewrite the
whole state. `/content/root/children/2` is a node,
`/content/root/children/2/tag` one of its properties, and
`/content/root/children/2/fields/url` a field the node carries. The root and a
node's `type` cannot be replaced on their own, and a node property cannot be
removed. A state whose root holds nothing is refused however it is written,
since Lexical reads it as empty and throws rather than rendering it; an empty
field is stored as null instead.

Node positions shift the moment anything is added or removed, and a text or
paragraph node carries no id to fall back on. `getDocument` with `outline`
answers with one line per node, its pointer, its `version` and an excerpt, so a
position can be chosen without holding the whole state. `expectedUpdatedAt`
still guards the document, and a `test` operation on a node's `type` guards the
position.

## Globals

A global is exposed the same way a collection is, and reached through the same
tools rather than tools of its own:

```ts
mcpxPlugin({
  collections: { pages: { read: true, write: "draft" } },
  globals: { "site-settings": { read: true, write: "draft" } },
});
```

Two rules follow from a global being a singleton. JSON Schema cannot state
either one, so both are enforced in the handler and repeated in every affected
tool description:

- Pass exactly **one** of `collection` and `global`.
- `id` is required with `collection` and must be omitted with `global`.

Refusals name the offending argument and the slug, so one failed call teaches
the rule. `findDocuments` and `createDocument` stay collection-only, since there
is nothing to list and nothing to create when the document always exists. They
reject a `global` argument by name.

Globals get their own `capabilities.globals.<name>` checkbox group, a separate
namespace from `capabilities.collections.<name>`, so a global may share a
camelCase name with a collection.

`expectedUpdatedAt` behaves as it does for collections, since Payload appends
`updatedAt` to every global. The exception is a global that has never been
saved: it has no `updatedAt` to compare against, so the first write must omit
`expectedUpdatedAt`, and supplying one is refused as a concurrency failure.

## API keys

Keys are created in the admin panel under MCP > API Keys. The plaintext key is
generated on create, stored encrypted with an HMAC index for lookup, and shown
to anyone who may read the key document (own keys only, by default). Each key:

- is bound to the user who created it and acts as that user. Every operation
  runs with `req.user` set to the linked user and `overrideAccess: false`, so
  your collection access control applies unchanged;
- carries one checkbox per exposed collection and operation, plus one per custom
  tool. All checkboxes default to off. A key can never enable an operation the
  plugin config does not expose, and keys created before a capability existed
  stay without it. The `publish` checkbox only exists where a versioned entity
  is configured `write: "live"`, and it counts only alongside `write`, since
  publishing is an extension of writing.

Keys authenticate only the MCP endpoint. They are deliberately not a Payload
auth strategy, so a key can never authenticate the REST or GraphQL API. The
reverse also holds: an admin session or JWT is ignored by the MCP endpoint.

Use `apiKeys.overrideCollection` to widen access (for example, admins manage all
keys) or add fields.

### The "Connect a client" tab

Saved keys carry a **Connect a client** tab in the admin holding the client
snippets from [Usage](#usage) with their own URL and key filled in, each block
behind a copy button. The tab only exists once the key does, so the create form
stays free of it. Turn it off with `apiKeys.setupGuide: false`, which also drops
the tabs and restores the flat form.

The tab renders an admin component, so it has to be in the import map:

```bash
payload generate:importmap
```

Without that entry Payload logs a missing-component error and renders nothing
else; the rest of the plugin is unaffected. The URL comes from `serverURL` when
the config sets one and from the browser's origin otherwise.

## Drafts and publishing

Every MCP write lands as a draft. That is enforced on the Payload operation
rather than in the tool handlers, through a `beforeOperation` hook that forces
`draft: true` and a `beforeChange` hook that refuses any write which would still
not land as a draft. Both are installed on every collection and global, so a
custom tool writing through the same request is covered as well.

`publishDocument` is the one way through. It refuses a document that fails
validation, and is refused while a human holds the document open in the admin
panel. Publishing covers the whole document, as the admin Publish button does,
but Payload only validates the locale the publish runs in, so a required field
left empty in another locale goes live empty. That is Payload's behaviour, not
something this plugin adds. There is no unpublish tool: reverting a published
document to a draft stays a human action.

Publish blockers are advisory. Payload skips validation on draft saves (unless
`versions.drafts.validate` is set), so after every write the plugin re-runs
Payload's own field validation over the saved draft and returns the failures as
`publishBlockers` with paths and labels. The write stands; the client gets a
checklist of what remains. Collections with `versions.drafts.validate: true`
refuse invalid drafts outright, and those failures come back as
`validationErrors` instead. Both carry pointers.

`publishBlockersUnavailable` marks a check that could not complete, which is a
different answer from a document with nothing wrong with it. Writes also report
`notApplied`: pointers whose value Payload kept unchanged, which happens when
field-level access denies the update.

Three limits apply to that check. Only the written locale is validated. Field
`beforeChange` hooks run again during it, so they must be pure. And it runs
privileged, so blocker paths and messages may name fields the key's user cannot
read, though values are never included. `validateDocument` runs the same
traversal without saving anything, which is why it carries no `readOnlyHint`.

## Custom tools

```ts
import { defineMcpxTool } from "@abinnovision/payloadcms-mcpx";
import { z } from "zod";

const publishQueue = defineMcpxTool({
  name: "queueForReview",
  description: "Marks a page as ready for editorial review.",
  inputSchema: { id: z.string() },
  handler: async ({ args, req }) => {
    // req.user is the key's linked user, req.context.mcpx carries the
    // key id and capabilities. Writes through payload.update({ req })
    // land as drafts like every other MCP write.
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

Custom tools take the same route as the builtins: one `McpxTool` shape, one
registration loop. Each gets its own checkbox on every API key, default off.

`handler` receives `scope` alongside `args`, `req` and `extra`. The scope
carries what the key may touch (`readable`, `writable`, `publishable`,
`readableGlobals`, `writableGlobals`, `publishableGlobals`), the configured
locales, the limits in force and the exposed collections and globals. `req` is
shorthand for `scope.req`.

`inputSchema` may be a function of that scope instead of a fixed shape, which is
how a tool narrows an enum to what the key may read:

```ts
import { defineMcpxTool } from "@abinnovision/payloadcms-mcpx";
import { z } from "zod";

const whichCollection = defineMcpxTool({
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

`defineMcpxTool` infers the handler's arguments from the input schema either
way, so `args` above is `{ collection: string }` without being told. Inference
reaches as far as the shape's static type, so a helper returning `z.ZodRawShape`
leaves `args` as `Record<string, unknown>`. Where that happens, state the
arguments as a type argument: `defineMcpxTool<Args>({ ... })`.

`isEnabled` decides whether the tool is registered for this key at all: a tool
that is not enabled never appears in `tools/list`. It defaults to the tool's own
checkbox, and defining it **replaces** that check, so restate
`scope.capabilities.tools[name]` when you still want it, as above.

Every input schema is registered strictly, custom tools included: an unknown
argument is rejected by name rather than stripped before the handler runs.

`jsonResult` and `errorResult` are exported so a custom tool can return results
shaped like a builtin's. `isMcpxRequest(req)` lets your own hooks tell an
MCP-originated write from any other.

## Security

- Keys are stored encrypted; lookup is by HMAC-SHA256 index derived from
  `payload.secret`, the same scheme Payload uses for its own API keys.
- The endpoint authenticates with Bearer keys only. Admin JWTs and cookies are
  ignored, and keys cannot authenticate REST or GraphQL.
- Every operation runs under the linked user with `overrideAccess: false`.
- Payload has no separate publish permission: at its access layer, anyone who
  may update a document may publish it. The `publish` checkbox is this plugin's
  fence, not Payload's.
- Custom tools are trusted code and can do what the linked user may.

## Non-goals

Unpublishing, `versions.drafts.localizeStatus`, deletes, creating upload
documents and any file handling, markdown authoring for rich text, schemas for
`upload` node fields, row addressing by id instead of index, cross-locale
publish blockers, pagination of `describeSchema` with `expand`, and a
handler-level timeout are all deliberate omissions for now.

## License

Apache-2.0
