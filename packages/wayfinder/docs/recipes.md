# Recipes

## A link component, in both colours

The package ships no link component on purpose. `router.link` is synchronous and touches nothing,
so it works identically in a server component and in a client component. The two versions differ
only in where the router comes from, which is a decision about your app, not about links.

The router is built once, from the values a request fixes:

```ts
import { createRouter } from "@abinnovision/payloadcms-wayfinder";

const router = createRouter({ mappings, locale, formatHref });
```

A component then takes that router rather than the pieces it was built from. Mappings alone do not
resolve a link: the locale decides which pattern is used, and `formatHref` decides what the finished
href looks like. A component that accepts the three as separate props is a component that can be
handed two of them.

A React Server Component:

```tsx
// components/AppLink.tsx
import type { LinkFieldData, Router } from "@abinnovision/payloadcms-wayfinder";
import type { ReactNode } from "react";

interface AppLinkProps {
  link: LinkFieldData | undefined;
  router: Router;
  children?: ReactNode;
}

export const AppLink = ({ link, router, children }: AppLinkProps) => {
  const resolved = router.link(link);

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

import { useWayfinder } from "./wayfinder-context.js";

import type { LinkFieldData } from "@abinnovision/payloadcms-wayfinder";
import type { ReactNode } from "react";

interface AppLinkClientProps {
  link: LinkFieldData | undefined;
  children?: ReactNode;
}

export const AppLinkClient = ({ link, children }: AppLinkClientProps) => {
  const router = useWayfinder();
  const resolved = router.link(link);

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

A router closes over compiled mappings, which are plain objects holding functions, so it does not
cross a serialization boundary. A client component either receives the already-resolved `href` as a
prop, or receives the raw mapping rows and builds its own router with `defineMappings` and
`createRouter` inside a client provider.

### With a link declaration

If the app declares link types with
[`defineLinks`](./linking.md#declaring-link-types-with-definelinks), the declaration and its context
go to `createRouter` and travel with the router from there:

```ts
const router = createRouter({
  mappings,
  locale,
  links,
  context: { filesBase: "/files" },
});
```

The component takes the same shape as before with two changes: `LinkDataOf` types the link prop, and
`Router<typeof links>` types the router.

```tsx
// components/AppLink.tsx
import type { links } from "../links/index.js";
import type { LinkDataOf, Router } from "@abinnovision/payloadcms-wayfinder";
import type { ReactNode } from "react";

interface AppLinkProps {
  link: LinkDataOf<typeof links> | undefined;
  router: Router<typeof links>;
  children?: ReactNode;
}

export const AppLink = ({ link, router, children }: AppLinkProps) => {
  const resolved = router.link(link);

  if (!resolved) {
    return <>{children ?? link?.label}</>;
  }

  return (
    <a
      href={resolved.href}
      target={resolved.target}
      rel={resolved.rel}
      download={resolved.download}
    >
      {children ?? link?.label}
    </a>
  );
};
```

`resolved.download` is readable without an annotation: the declaration the router was built with
carries its resolvers through to the return type. The same declaration also decides what `context`
must be, so passing the wrong shape is a compile error rather than an argument a resolver silently
cannot use.

The same declaration goes to `linkField` in `payload.config.ts`; a declaration that reaches one and
not the other is what the `unknown-variant` diagnostic reports.

Use `router.isAvailable` when the surrounding markup should disappear along with the link:

```tsx
{
  router.isAvailable(block.link, { withLabel: true }) && (
    <div className="cta">
      <AppLink link={block.link} router={router} />
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

    // The site root arrives as "/", which would otherwise build "/de/".
    return `${preview}${prefix}${path === "/" ? "" : path}` || "/";
  };
```

The root is the case to get right. It arrives as `"/"`, and concatenating a
prefix onto it produces `"/de/"` — a path with a trailing slash, which
[nothing normalises](./limitations.md#trailing-slashes-are-not-normalised) and
no pattern matches. Anything that emits a finished URL hits it: the German home
page in a sitemap, a canonical tag, an Open Graph URL.

Bind it to the router, and every path the router produces goes through it:

```ts
const router = createRouter({
  mappings,
  locale,
  formatHref: createFormatHref({ defaultLocale: "en", preview: isPreview }),
});

router.href("articles", document);
router.path("articles", values);
router.link(block.link);
```

That last call is why the formatter belongs on the router rather than on the call. `link` builds an
href internally, so a formatter it was not given is a formatter that does not apply — and the
result is not a cosmetic difference. A link resolved without it on a locale-prefixed site sends a
visitor out of the locale on the first click, and a page rendered inside a preview whose links were
resolved without it sends the editor straight out of preview. Bound once, none of the three calls
can disagree about what a finished href looks like.

The site root goes through `formatHref` too, so a wildcard collection's home document is not the
one path that misses the prefixes every other path receives.

### With a router that already prefixes the locale

Two different things are called a router in this section. Wayfinder's is the object `createRouter`
returns. next-intl's is the navigation set it builds from `createNavigation`, whose `Link` is the
one rendering the hrefs. Below, "the navigation" means next-intl's and "the router" means
wayfinder's.

Some routing libraries prefix the locale themselves. next-intl's `Link` is the common case: hand it
`/de/about` and it emits `/de/de/about`.

Wayfinder does not know what renders the hrefs it produces, so the rule is to prefix in exactly one
place. With the formatter bound to the router, that decision now attaches to which router you build
rather than to which call you remember to pass it to. A router built with no `formatHref` returns
paths untouched, which is already the right answer for links rendered through a navigation that
prefixes:

```ts
// Rendered through next-intl's Link, which adds the locale itself.
const router = createRouter({ mappings, locale });

router.link(block.link);
// -> { href: "/about" }, and the Link makes it "/de/about"
```

The places that need the prefix are the ones with no navigation in front of them, because they emit
a finished URL: sitemaps, feeds, canonical tags and Open Graph metadata. Build those their own
router with a prefixing `formatHref`:

```ts
const absolute: FormatHref = ({ path, locale }) =>
  `/${locale}${path === "/" ? "" : path}`;

const urls = createRouter({ mappings, locale, formatHref: absolute });

urls.path("articles", values);
```

Preview is the exception that still applies to links. If preview lives at a path prefix, links
rendered inside a preview must carry it or the first click leaves preview, so a next-intl site gives
the router it renders links with a preview-only formatter and lets the navigation keep owning the
locale:

```ts
const previewOnly: FormatHref = ({ path }) =>
  isPreview ? `/-preview${path}` : path;

const router = createRouter({ mappings, locale, formatHref: previewOnly });
```

Two related things to get right on such a site. The `path` you hand `router.resolve` must have the
locale already stripped, which is what a localized route segment gives you but not what
`usePathname()` does. And `locale` is passed straight to `payload.find`, so the navigation's locale
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
  createRouter,
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
      const path = createRouter({ mappings, locale }).path("articles", [
        section ?? "",
        String(doc["slug"] ?? ""),
      ]);

      return `/preview?path=${encodeURIComponent(path)}`;
    },
  },
  // ...
};
```

`resolveRelationshipSlug` returns `null` when the value names nothing resolvable, which callers
should treat as "no preview URL" rather than guessing. A parameter naming a plain field rather than
a relationship is returned as-is, so the same call is safe for every parameter in a pattern.

Which field it reads is not passed here. It is derived from the target collection's own pattern, and
falls back to whatever the mappings were compiled with — see
[`fallbackIdentifierField`](./code-defined-mappings.md#the-identifier-fallback).

An unpopulated relationship arrives as a bare id, and what type that id has follows the database
adapter: a string on Mongo, a number on SQLite and on serial Postgres. Both are accepted. Refusing
numbers is what would make every preview URL on the latter two resolve to `null`.

For a polymorphic relationship it tries each target in turn, reading only the identifier field, and
returns the first that answers.

## Request-scoped mappings

The mapping is read once per request and used by every link on the page. A footer with forty links
should not mean forty reads.

### With montage

`./montage` builds the router once and parks it on the render context:

```tsx
// app/[[...path]]/page.tsx
import { initWayfinder } from "@abinnovision/payloadcms-wayfinder/montage";

import { createRenderer, defineBlockRegistry } from "../montage.js";

const renderer = createRenderer(blocks);

const Page = async ({ data, locale }) => {
  const payload = await getPayload({ config });
  const ctx = createBlockContext({ locale, draft: false });

  await initWayfinder(ctx, { locale, load: { payload } });
  await renderer.resolveBlockData({ root: data, ctx });

  return <renderer.Block block={data} ctx={ctx} />;
};
```

`initWayfinder` takes everything `createRouter` takes, except that the mappings arrive either as
`load`, which reads them from an instance, or as `mappings` you already hold. A route that resolved
the request path holds them already, and reading the global a second time to render the same page is
a query for nothing:

```ts
const router = createRouter({ mappings, locale, formatHref });
const resolved = await router.resolve(path, { payload });

await initWayfinder(ctx, { mappings, locale, formatHref });
```

Any block then reads the router off the context it was already given:

```tsx
// blocks/CallToAction.tsx
import { wayfinderFrom } from "@abinnovision/payloadcms-wayfinder/montage";

import { defineBlockComponent } from "../montage.js";
import { AppLink } from "../components/AppLink.js";

export const CallToAction = defineBlockComponent("call-to-action", {
  component: ({ block, ctx }) => (
    <AppLink link={block.link} router={wayfinderFrom(ctx)}>
      {block.link?.label}
    </AppLink>
  ),
});
```

`wayfinderFrom` throws when `initWayfinder` has not run. A block that rendered links without a
locale would emit wrong ones silently, and a blank page is easier to explain than a page of quietly
mislocalised links. The extension slot is named `wayfinder:router`; extension names share one
namespace across every library using montage, which is why it carries the package prefix.
`wayfinderExtension` is exported if you need to read or write the slot directly.

### Without montage

The same shape in about twenty lines, using React's request-scoped `cache`:

```ts
// lib/wayfinder.ts
import { createRouter } from "@abinnovision/payloadcms-wayfinder";
import { loadMappings } from "@abinnovision/payloadcms-wayfinder/config";
import { cache } from "react";
import { getPayload } from "payload";

import config from "@payload-config";

const getMappings = cache(async () => {
  const payload = await getPayload({ config });

  return loadMappings({ payload });
});

export const getRouter = async (locale: string) =>
  createRouter({
    mappings: await getMappings(),
    locale,
    formatHref: createFormatHref(),
  });
```

```tsx
// app/[[...path]]/page.tsx
import { getRouter } from "../lib/wayfinder.js";

const Page = async () => {
  const router = await getRouter("en");

  return <Body router={router} />;
};
```

`cache` deduplicates per request, so every caller during one render shares a single read. Outside
React, a module-level promise or your framework's own request context does the same job. The router
then travels as a prop, which is the same thing the montage version does through the context.

Keeping construction in one exported function is the point of the shape. A catch-all route, its
metadata pass, a sitemap and a preview route all need a router, and none of them can build one that
has the mappings but not the formatter.
