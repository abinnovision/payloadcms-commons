# Recipes

Each of these is a real case from this package's test suite or from `apps/example`.

## Two collections that reference each other

A menu links to pages, and every page renders the menu. `dependsOn` cannot express that, and does
not need to: the reference pointing forward is written on the replay pass.

```ts
defineDummySeed({
  id: "authors",
  run: async (ctx) => {
    await ctx.doc("authors", {
      name: "Ada",
      featuredBook: ctx.ref("books", "Notes"),
    });
  },
});

defineDummySeed({
  id: "books",
  dependsOn: ["authors"],
  run: async (ctx) => {
    await ctx.doc("books", {
      title: "Notes",
      author: ctx.ref("authors", "Ada"),
    });
  },
});
```

`authors` is written first without `featuredBook`, `books` resolves its own reference
immediately, and the replay completes the author. Both documents end up linked.

Keep the `dependsOn` edge in one direction anyway. It is what decides which of the two gets
replayed, and without it the order is just declaration order.

## Circular required references

A header links to pages and every page requires the header. A required field cannot wait for the
replay, so write a placeholder first and the full document once its targets exist:

```ts
defineDummySeed({
  id: "header-placeholder",
  run: async (ctx) => {
    await ctx.doc(
      "headers",
      { name: "main", links: [] },
      { keepIfExists: true },
    );
  },
});

defineDummySeed({
  id: "pages",
  dependsOn: ["header-placeholder"],
  run: async (ctx) => {
    await ctx.doc("pages", {
      slug: "/",
      title: "Home",
      header: ctx.ref("headers", "main"),
    });
  },
});

defineDummySeed({
  id: "header",
  dependsOn: ["pages"],
  run: async (ctx) => {
    await ctx.doc("headers", {
      name: "main",
      links: [{ page: ctx.ref("pages", "/") }],
    });
  },
});
```

`keepIfExists` creates the placeholder on the first run and skips it on every later one, so a
re-run never empties the header the last unit wrote. A skipped document counts as `skipped` and
is not replayed. One that is created with refs pointing forward is still completed by the replay.

## A reference inside a blocks field

The walk is structural, so nothing special is needed:

```ts
await ctx.doc("pages", {
  slug: "/about/team",
  title: "The team",
  layout: [
    {
      blockType: "section-wrapper",
      modules: [
        {
          blockType: "call-to-action-module",
          heading: "Read the journal",
          link: {
            type: "reference",
            label: "Hello world",
            reference: ctx.polyRef("articles", "hello-world"),
          },
        },
      ],
    },
  ],
});
```

`polyRef` rather than `ref`, because a link field stores `{ relationTo, value }`.

If that reference points forward, the enclosing block is dropped from the first write and
restored by the replay. The rest of `layout` is written as normal.

## A reference inside a Lexical state

The `./lexical` entry builds an editor state from small helpers, so a seed does not spell out
`version`, `format` or `indent` on every node:

```ts
import * as rt from "@abinnovision/payloadcms-dummy/lexical";

await ctx.doc("pages", {
  slug: "/intro",
  content: rt.richText(
    rt.h("h2", "Getting started"),
    "A string is a plain paragraph.",
    rt.p(
      "Read ",
      rt.link(ctx.ref("articles", "hello-world"), "this one"),
      " or ",
      rt.text("skip it", "bold"),
      ".",
    ),
    rt.list("bullet", "First", [
      "Second with ",
      rt.link("https://example.com", "a link"),
    ]),
    rt.upload(ctx.ref("media", "hero.png")),
    rt.block("cta", { label: "Sign up", page: ctx.ref("pages", "/signup") }),
  ),
});
```

`link` and `upload` take either `ctx.ref` or `ctx.polyRef` and store the shape each node needs: a
link to a document becomes `fields: { linkType: "internal", doc: { relationTo, value } }`, an
upload becomes `{ relationTo, value }`. A string passed to `link` is a custom URL. Refs inside
`block` fields are resolved like refs in any other field.

`br()` and `tab()` are the line break and tab nodes. `align("center", rt.h("h1", "Title"))` sets
the alignment on any element node.

A link feature with its own fields gets its own builder, with the same signature as `link`:

```ts
const buttonLink = rt.createLink((to) => ({
  ...(typeof to === "string"
    ? { linkType: "custom", url: to }
    : { linkType: "internal", doc: ctx.polyRef(to.collection, to.key) }),
  newTab: false,
  appearance: "button",
}));
```

Wherever a builder takes content it also accepts a plain node object, so a quote, a horizontal
rule or any custom node goes in as written. The result of `richText` is assignable to the
generated rich text field type without a cast.

A rich text state is treated as one value: if any reference inside it is unresolved, the whole
field waits for the replay rather than being written with a link node missing. A paragraph never
loses its visible text.

## Uploads from a directory

```ts
import { readdirSync } from "node:fs";
import path from "node:path";

const ASSETS = path.resolve(import.meta.dirname, "assets");

defineDummySeed({
  id: "media",
  run: async (ctx) => {
    for (const name of readdirSync(ASSETS)) {
      await ctx.upload("media", path.join(ASSETS, name), { alt: name });
    }
  },
});
```

The basename is the natural key, so a later unit addresses the upload with
`ctx.ref("media", "hero.png")` and the second run updates the metadata without re-uploading the
bytes.

If the collection rewrites filenames in a hook, the basename no longer matches what is stored.
Add an indexed text field holding the original name and set `naturalKeys: { media: "name" }`.

Resolve the directory from `import.meta.dirname`, not from `process.cwd()`, so the assets travel
with the seed and `yarn seed` works from anywhere.

## A document or global an editor is allowed to own

```ts
await ctx.global(
  "site-settings",
  { title: "Example", tagline: "Placeholder copy" },
  { keepIfSet: "tagline" },
);
```

Once `tagline` carries a value the seed stops writing the global at all, so prose somebody
actually wrote survives every later run. The run reports it as skipped.

`ctx.doc` takes the same option. A document that does not exist yet is always written.

## A localized site

Build the data once and pick each localized value with `t`:

```ts
import { dummyLocalized } from "@abinnovision/payloadcms-dummy";

await ctx.doc(
  "pages",
  dummyLocalized((t) => ({
    slug: "/",
    title: t({ en: "Home", de: "Startseite" }),
    layout: [
      { blockType: "callout", body: t({ en: "Welcome", de: "Willkommen" }) },
    ],
  })),
);
```

The builder runs once per locale in `localization.localeCodes`. The default locale's result is
written first, every other locale's result is written over it. `t` answers the value for the
locale being built and falls back to the default locale's, so a value only one locale overrides
needs only that entry. `ctx.localized` is the same function, and `ctx.global` accepts the result
too.

Because every locale comes from the same structure, arrays line up by construction. It fails if
the Payload config has localization disabled, or if `locales` is passed as well.

The lower-level form names the overrides directly:

```ts
await ctx.doc(
  "pages",
  { slug: "/", title: "Home" },
  { locales: { de: { title: "Startseite" } } },
);
```

For an array whose rows carry a localized field, give both locales the same rows in the same
order and let the writer graft the ids:

```ts
await ctx.global(
  "collections-mapping",
  {
    collections: [
      { collectionName: "pages", path: "/*slug" },
      { collectionName: "sections", path: "/topic/:slug" },
    ],
  },
  {
    locales: {
      de: {
        collections: [
          { collectionName: "pages", path: "/*slug" },
          { collectionName: "sections", path: "/thema/:slug" },
        ],
      },
    },
  },
);
```

Without the grafted ids the German write would replace the rows and take the English patterns
with them. That is the hand-written read-back-and-rewrite pass this replaces.

## A seed set that differs per environment

`seeds` is an array, so compose it:

```ts
const base = [usersSeed, sectionsSeed, articlesSeed];

export const seeds =
  process.env.SEED_DEMO === "1" ? [...base, ...demoSeeds] : base;
```

Prefer this to a flag inside a unit's `run`. A unit that writes different content depending on
the environment is a unit whose `--only` behaviour nobody can predict.
