# Linking

A link authored in the CMS should follow its target when that target's URL pattern changes. That is
what the link field and `router.link` are for: the stored value names a document, and the href is
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

| `type`      | Fields shown         | Resolves to                                      |
| ----------- | -------------------- | ------------------------------------------------ |
| `none`      | none                 | `null` (only offered when `required: false`)     |
| `reference` | `reference`          | the mapped href of the populated target document |
| `custom`    | `url`                | the URL verbatim                                 |
| `same-page` | `samePageIdentifier` | `#<identifier>`                                  |

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
const wayfinder = createRouter({ mappings, locale, links, context });

wayfinder.link(link);
wayfinder.linkNode(node.fields);
wayfinder.isAvailable(link);
deriveLinkLabel(link, { links });
```

Passing it to all of them is the point. A variant that reaches the field but not the router is a
type an editor can select and a link that renders nothing, which is what the
[`unknown-variant` diagnostic](#the-unknown-variant-diagnostic) exists to name.

A variant's `fields` are rendered under a condition on the variant's own value, so they appear only
when that type is selected. `resolve` receives the link data and whatever you passed as `context`,
untouched. A variant with no `resolve` resolves to `null`.

Such a variant does not need the `variant(...)` builder either. A plain object literal in
`variants` keeps the same derived field typing, because that typing is read off `fields` in both
cases:

```ts
export const links = defineLinks()(() => ({
  variants: {
    anchor: {
      label: "Anchor",
      fields: [{ name: "offset", type: "number" }],
    },
  },
}));
```

`link.offset` is still `number | null | undefined` wherever the declaration is read. The builder
exists so that `.resolve()` and `.data<T>()` have somewhere to hang off, so it is only needed when
one of them is attached.

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

## `router.link`

Synchronous. It reads a link field's value and returns `{ href, target?, rel? }` or `null`.

```ts
import { createRouter } from "@abinnovision/payloadcms-wayfinder";

const wayfinder = createRouter({ mappings, locale: "en" });
const resolved = wayfinder.link(block.link);
```

The link's value is the only per-call argument, and `undefined` resolves to `null`. Everything
else is bound once, when the router is built:

| `createRouter` argument | Default  | Purpose                                                                               |
| ----------------------- | -------- | ------------------------------------------------------------------------------------- |
| `mappings`              | required | compiled mappings                                                                     |
| `locale`                | required | which locale's pattern to build with                                                  |
| `links`                 | unset    | the declaration built by `defineLinks`                                                |
| `context`               | unset    | passed to a variant's `resolve` untouched                                             |
| `formatHref`            | identity | rewrites the built path; see [`recipes.md`](./recipes.md#locale-prefixes-and-preview) |
| `resolveReference`      | unset    | resolve a reference without a populated document                                      |
| `onDiagnostic`          | unset    | why the link produced nothing                                                         |

Binding them is what keeps them consistent. `formatHref` has to reach every call that builds a
path, and the one easiest to forget is link resolution, which builds hrefs internally — omitting it
there sends a visitor out of the locale, or out of preview, on the first click.

Which field a relationship parameter matches on is not among them, because it does not vary per
request. It rides the compiled mappings as `fallbackIdentifierField`, set once by
[`loadMappings`](./integration.md) or `defineMappings`.

Resolution returns `null` rather than degrading to the site root. A link that silently points
somewhere plausible is harder to find than one that renders nothing.

### The `unknown-variant` diagnostic

`onDiagnostic` reports `unknown-variant`, with the offending value in `variant`, when a link's
`type` is neither a built-in nor a declared one. The usual cause is a declaration that reached
`linkField` but not the router, which would otherwise just make the link disappear:

```ts
const wayfinder = createRouter({
  mappings,
  locale,
  links,
  onDiagnostic: (d) => console.warn("[wayfinder]", d.reason, d.variant),
});
```

### Resolving references without population

An unpopulated reference is a bare id, which cannot be routed. The usual answer is
`defaultPopulate` ([`integration.md`](./integration.md#5-defaultpopulate-on-linkable-collections)).
A project that deliberately caps depth and keeps its own id-to-path index supplies
`resolveReference` instead:

```ts
const wayfinder = createRouter({
  mappings,
  locale,
  resolveReference: ({ relationTo, value }) =>
    myIndex.get(
      `${relationTo}:${typeof value === "object" ? value.id : value}`,
    ) ?? null,
});
```

An id is `string | number`, so the populated document is told apart by being an object rather than
by being anything else; a bare id of either type takes the other branch.

When supplied it takes over the whole `reference` branch, populated or not. One injected function
rather than a second built-in strategy: the package resolves from the populated document, and this
is the documented way out.

## `router.isAvailable`

Takes the same link value as `router.link`, plus an options object, and returns a boolean. Use it
to decide whether to render a link at all, rather than emitting a dead anchor:

```ts
const show = wayfinder.isAvailable(block.link, { withLabel: true });
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
`ResolvedLinkOf<typeof links>` is what resolving one can produce. Both are type-level extractors.
The declaration is plain data, and the one property `LinkDataOf` reads off a variant — `__data` —
is declared and never assigned, so it exists in the type and not at runtime. It is what carries a
[`.data<T>()`](#fields-this-cannot-type) override into the extracted shape instead of the derived
fields, so removing it as unused would silently drop every such override.

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

Passing `links` to `createRouter` carries the declaration's resolvers through to what `link` and
`linkNode` return, which is `ResolvedLinkOf<typeof links> | null` and nothing wider. A contributed
property is therefore readable without an annotation and without a cast:

```ts
const wayfinder = createRouter({
  mappings,
  locale,
  links,
  context: { filesBase: "/files" },
});

const resolved = wayfinder.link(block.link);

if (resolved?.download) {
  // ...
}
```

`ResolvedLinkOf` is still there for the times you want to name the type, in a prop or a return
signature.

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
          linkLabelFeature(),
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

`router.linkNode` takes a link node's `fields`:

```tsx
const converters = {
  link: ({ node, nodesToJSX }) => {
    const resolved = wayfinder.linkNode(node.fields);
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

The `fields` parameter is `unknown`, because Lexical types them as an open record and a narrower
one would make every converter cast. That also keeps rendering off the
`@payloadcms/richtext-lexical` peer: a frontend that renders rich text does not have to install the
editor to resolve the links in it.
