# Recipes

## A link component, in both colours

The package ships no link component on purpose. `resolveLink` is synchronous and touches nothing,
so it works identically in a server component and in a client component. The two versions differ
only in where the mappings come from, which is a decision about your app, not about links.

A React Server Component, reading the mapping on the server:

```tsx
// components/AppLink.tsx
import { resolveLink } from "@abinnovision/payloadcms-wayfinder";

import type {
  LinkFieldData,
  PayloadCollectionMappingResolved,
} from "@abinnovision/payloadcms-wayfinder";
import type { ReactNode } from "react";

interface AppLinkProps {
  link: LinkFieldData | undefined;
  mappings: PayloadCollectionMappingResolved[];
  locale: string;
  children?: ReactNode;
}

export const AppLink = ({ link, mappings, locale, children }: AppLinkProps) => {
  const resolved = resolveLink({ link, mappings, locale });

  if (!resolved) {
    return <>{children ?? link?.label}</>;
  }

  return (
    <a href={resolved.href} target={resolved.target} rel={resolved.rel}>
      {children ?? link?.label}
    </a>
  );
};
```

A client component, for anything interactive. The body is the same call:

```tsx
// components/AppLinkClient.tsx
"use client";

import { resolveLink } from "@abinnovision/payloadcms-wayfinder";
import { useMappings } from "./mappings-context.js";

import type { LinkFieldData } from "@abinnovision/payloadcms-wayfinder";
import type { ReactNode } from "react";

interface AppLinkClientProps {
  link: LinkFieldData | undefined;
  locale: string;
  children?: ReactNode;
}

export const AppLinkClient = ({
  link,
  locale,
  children,
}: AppLinkClientProps) => {
  const mappings = useMappings();
  const resolved = resolveLink({ link, mappings, locale });

  if (!resolved) {
    return <>{children ?? link?.label}</>;
  }

  return (
    <a
      href={resolved.href}
      target={resolved.target}
      rel={resolved.rel}
      onClick={() => track(resolved.href)}
    >
      {children ?? link?.label}
    </a>
  );
};
```

Compiled mappings are plain objects holding functions, so they do not cross a serialization
boundary. A client component either receives the already-resolved `href` as a prop, or receives the
raw mapping rows and compiles them with `defineMappings` inside a client provider.

Use `isAvailableLink` when the surrounding markup should disappear along with the link:

```tsx
{
  isAvailableLink({ link: block.link, mappings, locale, withLabel: true }) && (
    <div className="cta">
      <AppLink link={block.link} mappings={mappings} locale={locale} />
    </div>
  );
}
```

## Locale prefixes and preview

Locale prefixing and preview prefixing are the same transform applied at the same point, so they
share one hook rather than competing for two options. `formatHref` receives the built path and the
locale, and returns whatever the site actually serves:

```ts
import type { FormatHref } from "@abinnovision/payloadcms-wayfinder";

export const createFormatHref =
  (opts: { defaultLocale: string; preview: boolean }): FormatHref =>
  ({ path, locale }) => {
    const prefix = locale === opts.defaultLocale ? "" : `/${locale}`;
    const preview = opts.preview ? "/preview" : "";

    return `${preview}${prefix}${path}` || "/";
  };
```

Pass it to every function that produces a path:

```ts
const formatHref = createFormatHref({
  defaultLocale: "en",
  preview: isPreview,
});

buildHref({ mappings, collection: "articles", document, locale, formatHref });
buildPath({ mappings, collection: "articles", locale, values, formatHref });
resolveLink({ link: block.link, mappings, locale, formatHref });
```

The third line is the one that is easy to forget and the one that matters most. `resolveLink` calls
`buildHref` internally, so a `formatHref` it was not given is a `formatHref` that does not apply.
A page rendered inside a preview whose links were resolved without it sends the editor straight
out of preview on the first click. Build the formatter once per request, alongside the mappings,
and thread both together.

The site root goes through `formatHref` too, so a wildcard collection's home document is not the
one path that misses the prefixes every other path receives.

### With a router that already prefixes the locale

Some routing libraries prefix the locale themselves. next-intl's `Link` from `createNavigation` is
the common case: hand it `/de/about` and it emits `/de/de/about`.

Wayfinder does not know which router it is feeding, so the rule is to prefix in exactly one place.
The default `formatHref` returns the path untouched, which is already the right answer for a link
rendered through a router that prefixes:

```ts
// Rendered through next-intl's Link, which adds the locale itself.
const resolved = resolveLink({ link, mappings, locale });
// -> { href: "/about" }, and the Link makes it "/de/about"
```

The places that need the prefix are the ones with no router in front of them, because they emit a
finished URL: sitemaps, feeds, canonical tags and Open Graph metadata. Give those a prefixing
`formatHref` and leave link resolution on the default:

```ts
const absolute: FormatHref = ({ path, locale }) => `/${locale}${path}`;

buildPath({
  mappings,
  collection: "articles",
  locale,
  values,
  formatHref: absolute,
});
```

Preview is the exception that still applies to links. If preview lives at a path prefix, links
rendered inside a preview must carry it or the first click leaves preview, so a next-intl site
passes a preview-only formatter to `resolveLink` and lets the router keep owning the locale:

```ts
const previewOnly: FormatHref = ({ path }) =>
  isPreview ? `/-preview${path}` : path;

resolveLink({ link, mappings, locale, formatHref: previewOnly });
```

Two related things to get right on such a site. The `path` you hand `resolvePathToDocument` must
have the locale already stripped, which is what a localized route segment gives you but not what
`usePathname()` does. And `locale` is passed straight to `payload.find`, so the router's locale
codes have to be the ones Payload is configured with.

## An admin preview URL

`admin.preview` is handed the document as the form holds it, where a relationship is still a bare
id and there is no populated document to read a slug off. A URL built from that id would never
match back, because the path lookup queries the related document's identifier.
`resolveRelationshipSlug` is the inverse: it turns the parameter's raw value into the identifier
behind it, whether that value is already populated or still an id.

```ts
// collections/articles.ts
import {
  buildPath,
  resolveRelationshipSlug,
} from "@abinnovision/payloadcms-wayfinder";
import { loadMappings } from "@abinnovision/payloadcms-wayfinder/config";

import type { CollectionConfig } from "payload";

export const articles: CollectionConfig = {
  slug: "articles",
  defaultPopulate: { slug: true, section: true, title: true },
  admin: {
    preview: async (doc, { req }) => {
      const mappings = await loadMappings({ payload: req.payload });
      const config = req.payload.collections["articles"]?.config;

      if (!config) {
        return null;
      }

      const locale = req.locale ?? "en";

      const section = await resolveRelationshipSlug({
        payload: req.payload,
        config,
        param: "section",
        value: doc["section"],
        mappings,
        locale,
      });

      // Pattern order: "/:section/:slug".
      const path = buildPath({
        mappings,
        collection: "articles",
        locale,
        values: [section ?? "", String(doc["slug"] ?? "")],
      });

      return `/preview?path=${encodeURIComponent(path)}`;
    },
  },
  // ...
};
```

`resolveRelationshipSlug` returns `null` when the value names nothing resolvable, which callers
should treat as "no preview URL" rather than guessing. A parameter naming a plain field rather than
a relationship is returned as-is, so the same call is safe for every parameter in a pattern.

For a polymorphic relationship it tries each target in turn, reading only the identifier field, and
returns the first that answers.

## Request-scoped mappings

The mapping is read once per request and used by every link on the page. A footer with forty links
should not mean forty reads.

### With montage

`./montage` parks the compiled mappings on the render context:

```tsx
// app/[[...path]]/page.tsx
import { initWayfinder } from "@abinnovision/payloadcms-wayfinder/montage";

import { createRenderer, defineBlockRegistry } from "../montage.js";

const renderer = createRenderer(blocks);

const Page = async ({ data, locale }) => {
  const payload = await getPayload({ config });
  const ctx = createBlockContext({ locale, draft: false });

  await initWayfinder(ctx, { payload });
  await renderer.resolveBlockData({ root: data, ctx });

  return <renderer.Block block={data} ctx={ctx} />;
};
```

Any block then reads them off the context it was already given:

```tsx
// blocks/CallToAction.tsx
import { getMappings } from "@abinnovision/payloadcms-wayfinder/montage";

import { defineBlockComponent } from "../montage.js";
import { AppLink } from "../components/AppLink.js";

export const CallToAction = defineBlockComponent("call-to-action", {
  component: ({ block, ctx }) => (
    <AppLink link={block.link} mappings={getMappings(ctx)} locale={ctx.locale}>
      {block.link?.label}
    </AppLink>
  ),
});
```

`getMappings` returns an empty list when `initWayfinder` has not run, so a block rendered outside a
request renders without links rather than throwing. The extension slot is named
`wayfinder:mappings`; extension names share one namespace across every library using montage, which
is why it carries the package prefix. `wayfinderExtension` is exported if you need to read or write
the slot directly.

### Without montage

The same shape in about fifteen lines, using React's request-scoped `cache`:

```ts
// lib/wayfinder.ts
import { loadMappings } from "@abinnovision/payloadcms-wayfinder/config";
import { cache } from "react";
import { getPayload } from "payload";

import config from "@payload-config";

export const getMappings = cache(async () => {
  const payload = await getPayload({ config });

  return loadMappings({ payload });
});
```

```tsx
// app/[[...path]]/page.tsx
import { getMappings } from "../lib/wayfinder.js";

const Page = async () => {
  const mappings = await getMappings();

  return <Body mappings={mappings} locale="en" />;
};
```

`cache` deduplicates per request, so every component that calls `getMappings()` during one render
shares a single read. Outside React, a module-level promise or your framework's own request context
does the same job. Either way the mappings then travel as a prop, which is the same thing the
montage version does through the context.
