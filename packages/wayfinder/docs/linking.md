# Linking

A link authored in the CMS should follow its target when that target's URL pattern changes. That is
what the link field and `resolveLink` are for: the stored value names a document, and the href is
derived from the mapping at render time rather than baked in at authoring time.

## `linkField`

```ts
// blocks/call-to-action.config.ts
import { linkField } from "@abinnovision/payloadcms-wayfinder/config";

import type { Block } from "payload";

export const callToActionBlock: Block = {
  slug: "call-to-action",
  fields: [
    { name: "heading", type: "text" },
    linkField({
      relationTo: ["pages", "articles"],
      withLabel: true,
      required: false,
    }),
  ],
};
```

It returns a `group` field named `link`.

| Argument         | Default                  | Purpose                                                                                                                   |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `relationTo`     | required                 | every collection that can be linked to; a target missing here cannot be picked                                            |
| `variants`       | `[]`                     | app-declared link types, appended after the built-ins                                                                     |
| `required`       | `true`                   | when false, adds the `none` type and defaults to it                                                                       |
| `withLabel`      | `false`                  | shows a `label` text field                                                                                                |
| `localizedLabel` | `true`                   | whether that label is localized                                                                                           |
| `labels`         | built-in English strings | admin labels for the type options and sub-fields                                                                          |
| `interfaceName`  | unset                    | generated-type name; unset because a package cannot claim a global one and two calls with different targets would collide |

Each conditional sub-field declares itself optional and re-implements required-ness inside its own
`validate`. Payload validates hidden fields too, so a plain `required: true` behind a condition
would block saving whenever a different link type was selected.

## The built-in variants

| `type`      | Fields shown         | Resolves to                                  |
| ----------- | -------------------- | -------------------------------------------- |
| `none`      | none                 | `null` (only offered when `required: false`) |
| `reference` | `reference`          | `buildHref` of the populated target document |
| `custom`    | `url`                | the URL verbatim                             |
| `same-page` | `samePageIdentifier` | `#<identifier>`                              |

`newTab` is available on every type and adds `target: "_blank"` and `rel: "noopener noreferrer"` to
the resolved link. It is not applied to `same-page`, which is an in-page anchor.

## App-declared variants

A variant is one object carrying both its admin fields and its resolver, so a link type is defined
in exactly one place:

```ts
// links/download-variant.ts
import type { LinkVariant } from "@abinnovision/payloadcms-wayfinder";

export interface DownloadExtra {
  fileId?: string | null;
}

export interface AppLinkContext {
  assetBaseUrl: string;
}

export const downloadVariant: LinkVariant<AppLinkContext, DownloadExtra> = {
  value: "download",
  label: "File download",
  fields: [{ name: "fileId", type: "text" }],
  resolve: ({ link, context }) =>
    link.fileId
      ? { href: `${context.assetBaseUrl}/${link.fileId}`, fileId: link.fileId }
      : null,
};
```

Pass it to the field and to the resolver:

```ts
linkField<AppLinkContext, DownloadExtra>({
  relationTo: ["pages", "articles"],
  variants: [downloadVariant],
});
```

```ts
resolveLink<AppLinkContext, DownloadExtra>({
  link: block.link,
  mappings,
  locale,
  variants: [downloadVariant],
  context: { assetBaseUrl: "/assets" },
});
```

A variant's `fields` are rendered under a condition on the variant's own value, so they appear only
when that type is selected. `resolve` receives the link data and whatever you passed as `context`,
untouched. A variant with no `resolve` resolves to `null`.

## `resolveLink`

Synchronous. It reads a link field's value and returns `{ href, target?, rel? }` or `null`.

```ts
import { resolveLink } from "@abinnovision/payloadcms-wayfinder";

const resolved = resolveLink({ link: block.link, mappings, locale: "en" });
```

| Argument           | Default  | Purpose                                                                               |
| ------------------ | -------- | ------------------------------------------------------------------------------------- |
| `link`             | required | the link group's value; `undefined` resolves to `null`                                |
| `mappings`         | required | compiled mappings                                                                     |
| `locale`           | required | which locale's pattern to build with                                                  |
| `variants`         | unset    | app-declared link types                                                               |
| `context`          | unset    | passed to a variant's `resolve` untouched                                             |
| `formatHref`       | identity | rewrites the built path; see [`recipes.md`](./recipes.md#locale-prefixes-and-preview) |
| `identifierField`  | `"slug"` | fallback identifier for relationship parameters                                       |
| `resolveReference` | unset    | resolve a reference without a populated document                                      |
| `onDiagnostic`     | unset    | why the link produced nothing                                                         |

It returns `null` rather than degrading to the site root. A link that silently points somewhere
plausible is harder to find than one that renders nothing.

### Resolving references without population

An unpopulated reference is a bare id string, which cannot be routed. The usual answer is
`defaultPopulate` ([`integration.md`](./integration.md#5-defaultpopulate-on-linkable-collections)).
A project that deliberately caps depth and keeps its own id-to-path index supplies
`resolveReference` instead:

```ts
resolveLink({
  link: block.link,
  mappings,
  locale,
  resolveReference: ({ relationTo, value }) =>
    myIndex.get(
      `${relationTo}:${typeof value === "string" ? value : value.id}`,
    ) ?? null,
});
```

When supplied it takes over the whole `reference` branch, populated or not. One injected function
rather than a second built-in strategy: the package resolves from the populated document, and this
is the documented way out.

## `isAvailableLink`

Takes the same arguments as `resolveLink`, plus `withLabel`, and returns a boolean. Use it to
decide whether to render a link at all, rather than emitting a dead anchor:

```ts
import { isAvailableLink } from "@abinnovision/payloadcms-wayfinder";

const show = isAvailableLink({
  link: block.link,
  mappings,
  locale,
  withLabel: true,
});
```

With `withLabel: true`, a link whose `label` is empty counts as unavailable even if its href would
resolve.

## The generic types

Two type parameters run through the linking API.

`LinkFieldData<TVariant, TExtra>` is the structural shape of the stored group. `TVariant` carries
any app-declared variant names beyond the four built-ins, and `TExtra` the fields those variants
contribute:

```ts
type DownloadLink = LinkFieldData<"download", DownloadExtra>;
// { type?: "none" | "reference" | "custom" | "same-page" | "download" | null,
//   label?, reference?, url?, samePageIdentifier?, newTab? } & Partial<DownloadExtra>
```

It is declared in the package rather than imported from a project's generated types, so the field
definition does not depend on its own output. Every property is nullable, because that is how
Payload emits optional fields; a mismatch there shows up at every call site.

`ResolvedLink<E>` is `{ href, target?, rel? }` widened by whatever a variant returns. `E` defaults
to `object` rather than `unknown`, because an intersection with an uninstantiated type parameter
stays deferred and would force a cast at every built-in branch. `BaseResolvedLink` is the
unwidened shape.

## The Lexical feature

`wayfinderLinkFeature` replaces Lexical's own link fields with the wayfinder link field, so a link
written in rich text routes through the mapping exactly like a link authored in a block. It takes
the same arguments as `linkField`.

```ts
// collections/articles.ts
import {
  linkLabelFeature,
  wayfinderLinkFeature,
} from "@abinnovision/payloadcms-wayfinder/lexical";
import { lexicalEditor } from "@payloadcms/richtext-lexical";

export const articles: CollectionConfig = {
  slug: "articles",
  defaultPopulate: { slug: true, section: true, title: true },
  fields: [
    {
      name: "body",
      type: "richText",
      editor: lexicalEditor({
        features: ({ defaultFeatures }) => [
          ...defaultFeatures,
          wayfinderLinkFeature({ relationTo: ["pages", "articles"] }),
          linkLabelFeature,
        ],
      }),
    },
  ],
};
```

`linkLabelFeature` is optional but worth adding. Payload's floating link editor builds its hover
preview from a top-level `label` and `url`, neither of which a nested link group populates, so
without it the preview is blank for every link. The feature derives a short destination hint
(`articles/6716b1f0`, `#section-two`, `https://example.com`) whenever a link is created or edited.
The hint describes where the link points rather than what it says; anchor text would look like a
resolved title while telling an editor nothing about the destination. It runs on the create and
edit path rather than as an always-on node transform, so documents are never mutated merely by
being opened.

`linkLabelFeature` mounts a client component from the `./admin` entrypoint, so run
`payload generate:importmap` after adding it, as for any plugin contributing admin components.

### Rendering a link node

`resolveLinkNode` takes a link node's `fields` and the usual link-resolution arguments:

```tsx
import { resolveLinkNode } from "@abinnovision/payloadcms-wayfinder/lexical";

const converters = {
  link: ({ node, nodesToJSX }) => {
    const resolved = resolveLinkNode({ fields: node.fields, mappings, locale });
    const children = nodesToJSX({ nodes: node.children });

    return resolved ? (
      <a href={resolved.href} target={resolved.target} rel={resolved.rel}>
        {children}
      </a>
    ) : (
      <>{children}</>
    );
  },
};
```

It accepts both shapes a link node can arrive in: the nested `link` group written by
`wayfinderLinkFeature`, and the top-level `linkType` / `doc` / `url` that Lexical's stock link
feature wrote and that existing content still holds. It returns `null` when the node points nowhere
resolvable, so a converter can render the text without an anchor rather than emitting a dead one.
