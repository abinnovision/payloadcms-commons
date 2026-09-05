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
| `links`          | unset                    | the declaration built by [`defineLinks`](#declaring-link-types-with-definelinks)                                          |
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

## Declaring link types with `defineLinks`

`defineLinks` declares an app's link vocabulary once. Each variant carries its admin label, the
fields it contributes, and how it turns into an href, so a link type is defined in exactly one
place:

```ts
// links/index.ts
import { defineLinks } from "@abinnovision/payloadcms-wayfinder";

export interface AppLinkContext {
  filesBase: string;
}

export const links = defineLinks<AppLinkContext>()((variant) => ({
  variants: {
    download: variant({
      label: "Download",
      fields: [
        { name: "fileName", type: "text" },
        {
          name: "disposition",
          type: "select",
          options: ["inline", "attachment"],
        },
      ],
    }).resolve(({ link, context }) => ({
      href: `${context.filesBase}/${link.fileName ?? ""}`,
      download: link.disposition !== "inline",
    })),
  },
}));
```

Each key is the variant's stored `type` value, so `download` is what `link.type` holds.

Then pass the same declaration everywhere a link is handled:

```ts
linkField({ relationTo: ["pages", "articles"], links });
wayfinderLinkFeature({ relationTo: ["pages", "articles"], links });
```

```ts
resolveLink({ link, links, mappings, locale, context });
isAvailableLink({ link, links, mappings, locale, context });
resolveLinkNode({ fields: node.fields, links, mappings, locale, context });
deriveLinkLabel(link, { links });
```

Passing it to all of them is the point. A variant that reaches the field but not the resolver is a
type an editor can select and a link that renders nothing, which is what the
[`unknown-variant` diagnostic](#the-unknown-variant-diagnostic) exists to name.

A variant's `fields` are rendered under a condition on the variant's own value, so they appear only
when that type is selected. `resolve` receives the link data and whatever you passed as `context`,
untouched. A variant with no `resolve` resolves to `null`.

### Field types are derived, not written

The type of each contributed field comes from the `fields` array itself. Inside the resolver above,
`link.fileName` is `string | null | undefined` and `link.disposition` is
`"inline" | "attachment" | null | undefined`, both without a hand-written type anywhere.

That is the main thing the declaration buys. Renaming a field's `name`, or removing an option from
a `select`, breaks every reader of it at compile time rather than at render time.

Only scalar field types are modelled. Anything else contributes `unknown`; see
[`limitations.md`](./limitations.md#only-scalar-variant-fields-are-typed).

### Why the API has the shape it has

Two things about the call signature are deliberate.

**Two calls, `variant({...}).resolve(...)`.** TypeScript will not contextually type a resolver from
a sibling property of the same object literal, so a single object with `fields` and `resolve` next
to each other would leave the resolver's `link` untyped. Passing the fields through `variant(...)`
first is what lets `.resolve()` see them.

**Curried, `defineLinks<Ctx>()(...)`.** TypeScript has no partial type-argument inference. Naming
the context type up front in a single call would force every variant's fields to be named too, so
the context type goes in the first call and everything else is inferred in the second. Omit the
type argument entirely if no variant needs a context.

### Replacing a built-in

A variant may claim a built-in's value (`reference`, `custom`, `same-page`, `none`) to replace how
it resolves. The declaration is consulted before the built-ins, so the variant wins:

```ts
export const links = defineLinks()((variant) => ({
  variants: {
    "same-page": variant({
      label: "Section on this page",
      fields: [{ name: "offset", type: "number" }],
    }).resolve(({ link }) =>
      link.samePageIdentifier
        ? { href: `#${link.samePageIdentifier}`, offset: link.offset ?? 0 }
        : null,
    ),
  },
}));
```

The radio option is not offered twice. It keeps the built-in's position in the list, because
editors read that list by shape, and takes the variant's label.

The built-ins are defaults rather than a fixed set. An in-page link that has to offset for a fixed
header, or an internal link routed through something other than the mapping, is still the same link
type to an editor and should not need a second one invented for it.

### Fields this cannot type

A few field types resolve to `unknown`, because guessing at their shape would produce something
wrong rather than something vague, and a wrong type gets believed. `.data<T>()` names the shape for
those, leaving the rest of the variant derived:

```ts
interface ScheduleData {
  window?: { from: string; to: string } | null;
}

const links = defineLinks<AppLinkContext>()((variant) => ({
  variants: {
    scheduled: variant({
      label: "Scheduled",
      fields: [{ name: "window", type: "group", fields: [] }],
    })
      .data<ScheduleData>()
      .resolve(({ link }) => ({ href: "/", from: link.window?.from })),
  },
}));
```

It replaces the derived shape rather than adding to it, so name every field the resolver reads.
See [`docs/limitations.md`](./limitations.md) for which types are derived.

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
| `links`            | unset    | the declaration built by `defineLinks`                                                |
| `context`          | unset    | passed to a variant's `resolve` untouched                                             |
| `formatHref`       | identity | rewrites the built path; see [`recipes.md`](./recipes.md#locale-prefixes-and-preview) |
| `identifierField`  | `"slug"` | fallback identifier for relationship parameters                                       |
| `resolveReference` | unset    | resolve a reference without a populated document                                      |
| `onDiagnostic`     | unset    | why the link produced nothing                                                         |

It returns `null` rather than degrading to the site root. A link that silently points somewhere
plausible is harder to find than one that renders nothing.

### The `unknown-variant` diagnostic

`onDiagnostic` reports `unknown-variant`, with the offending value in `variant`, when a link's
`type` is neither a built-in nor a declared one. The usual cause is a declaration that reached
`linkField` but not `resolveLink`, which would otherwise just make the link disappear:

```ts
resolveLink({
  link: block.link,
  links,
  mappings,
  locale,
  onDiagnostic: (d) => console.warn("[wayfinder]", d.reason, d.variant),
});
```

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
  links,
  mappings,
  locale,
  withLabel: true,
});
```

With `withLabel: true`, a link whose `label` is empty counts as unavailable even if its href would
resolve.

## `deriveLinkLabel`

Returns a short destination hint for a link (`articles/6716b1f0`, `#section-two`,
`https://example.com`), or `undefined` when the link points nowhere. It is what
[`linkLabelFeature`](#the-lexical-feature) writes into a rich-text link node so the floating link
editor has a hover preview.

```ts
import { deriveLinkLabel } from "@abinnovision/payloadcms-wayfinder";

const hint = deriveLinkLabel(block.link, { links });
```

For a declared variant it returns the variant's own value, which is the only thing the package can
say about a link type whose fields it does not know.

## The two type extractors

`LinkDataOf<typeof links>` is the stored shape of a link field built from a declaration, and
`ResolvedLinkOf<typeof links>` is what resolving one can produce. Both are type-level extractors:
the declaration is a plain value with no `$data` property to read them off.

```ts
import type {
  LinkDataOf,
  ResolvedLinkOf,
} from "@abinnovision/payloadcms-wayfinder";

import { links } from "./links/index.js";

type AppLink = LinkDataOf<typeof links>;
// { type?: "none" | "reference" | "custom" | "same-page" | "download" | null,
//   label?, reference?, url?, samePageIdentifier?, newTab?,
//   fileName?: string | null,
//   disposition?: "inline" | "attachment" | null }

type AppResolvedLink = ResolvedLinkOf<typeof links>;
// { href: string, target?: string, rel?: string, download?: boolean }
```

`type` is the union of the built-ins and every declared key. The contributed properties are
optional on both, and for the same reason: each type is the union across all variants, and no
single variant can supply the others' properties. A resolver returns its own and nothing else.

Passing `links` carries the declaration's resolvers through to the return type, so a contributed
property is readable without an annotation. `ResolvedLinkOf` is still there for the times you want
to name the type, in a prop or a return signature:

```ts
const resolved = resolveLink({
  link: block.link,
  links,
  mappings,
  locale,
  context: { filesBase: "/files" },
});

if (resolved?.download) {
  // ...
}
```

### The underlying types

`LinkDataOf` and `ResolvedLinkOf` are built out of two types you can also use directly, when you
want to name a link's shape without a declaration in hand.

`LinkFieldData<TVariant, TExtra>` is the structural shape of the stored group. `TVariant` carries
any app-declared variant names beyond the four built-ins, and `TExtra` the fields those variants
contribute. It is declared in the package rather than imported from a project's generated types, so
the field definition does not depend on its own output. Every property is nullable, because that is
how Payload emits optional fields; a mismatch there shows up at every call site.

`ResolvedLink<E>` is `{ href, target?, rel? }` widened by whatever a variant returns. `E` defaults
to `object` rather than `unknown`, because an intersection with an uninstantiated type parameter
stays deferred and would force a cast at every built-in branch. `BaseResolvedLink` is the unwidened
shape.

## The Lexical feature

`wayfinderLinkFeature` replaces Lexical's own link fields with the wayfinder link field, so a link
written in rich text routes through the mapping exactly like a link authored in a block. It takes
the same arguments as `linkField`, including `links`.

```ts
// collections/articles.ts
import {
  linkLabelFeature,
  wayfinderLinkFeature,
} from "@abinnovision/payloadcms-wayfinder/lexical";
import { lexicalEditor } from "@payloadcms/richtext-lexical";

import { links } from "../links/index.js";

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
          wayfinderLinkFeature({ relationTo: ["pages", "articles"], links }),
          linkLabelFeature,
        ],
      }),
    },
  ],
};
```

`linkLabelFeature` is optional but worth adding. Payload's floating link editor builds its hover
preview from a top-level `label` and `url`, neither of which a nested link group populates, so
without it the preview is blank for every link. The feature derives a short destination hint with
`deriveLinkLabel` whenever a link is created or edited. The hint describes where the link points
rather than what it says; anchor text would look like a resolved title while telling an editor
nothing about the destination. It runs on the create and edit path rather than as an always-on node
transform, so documents are never mutated merely by being opened.

`linkLabelFeature` mounts a client component from the `./admin` entrypoint, so run
`payload generate:importmap` after adding it, as for any plugin contributing admin components.

### Rendering a link node

`resolveLinkNode` takes a link node's `fields` and the usual link-resolution arguments:

```tsx
import { resolveLinkNode } from "@abinnovision/payloadcms-wayfinder/lexical";

import { links } from "../links/index.js";

const converters = {
  link: ({ node, nodesToJSX }) => {
    const resolved = resolveLinkNode({
      fields: node.fields,
      links,
      mappings,
      locale,
    });
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
