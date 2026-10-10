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

A hand-written editor state is a plain literal, so a reference goes straight into the link node:

```ts
const introContent = (ctx: DummyContext) => ({
  root: {
    type: "root",
    format: "",
    indent: 0,
    version: 1,
    direction: "ltr",
    children: [
      {
        type: "link",
        version: 3,
        fields: {
          link: {
            type: "reference",
            label: "Hello world",
            reference: ctx.polyRef("articles", "hello-world"),
          },
        },
        children: [{ type: "text", text: "this one", version: 1 }],
      },
    ],
  },
});
```

A rich text state is treated as one value: if any reference inside it is unresolved, the whole
field waits for the replay rather than being written with a link node missing. A paragraph never
loses its visible text.

The generated type for a rich text field describes the node union Lexical produces, which is
wider than a hand-written literal satisfies, so the field usually needs a cast. The reference is
still typed, because `polyRef` returns one.

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

Resolve the directory from `import.meta.dirname`, not from `process.cwd()`, so the assets travel
with the seed and `yarn seed` works from anywhere.

## A global an editor is allowed to own

```ts
await ctx.global(
  "site-settings",
  { title: "Example", tagline: "Placeholder copy" },
  { keepIfSet: "tagline" },
);
```

Once `tagline` carries a value the seed stops writing the global at all, so prose somebody
actually wrote survives every later run. The run reports it as skipped.

## A localized site

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
