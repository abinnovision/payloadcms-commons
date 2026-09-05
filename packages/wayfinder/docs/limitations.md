# Limitations

Each of these is a deliberate boundary or a known consequence of one. None of them are bugs, and
knowing about them beforehand is cheaper than finding them in production.

## One URL per document

A collection has one pattern per locale, and a document has one href. There is no notion of an
alias, a canonical URL, or a legacy URL that should redirect.

**Consequence.** Renaming a collection's pattern changes every URL under it at once, and the old
URLs stop resolving. A document that used to live at `/journal/hello-world` and now lives at
`/articles/hello-world` returns nothing at the old path. There is nowhere in the mapping to say
"also served at", and nothing emits a canonical tag.

**Workaround.** Redirects belong to the layer above. Keep a redirect collection of your own and
consult it in the catch-all route when `resolvePathToDocument` returns `null`, or use Payload's
redirects plugin. For canonicals, `buildHref` gives you the one true URL of a document, which is
exactly what a `<link rel="canonical">` needs.

## One mapping per instance

The mapping global is a singleton. Every collection appears at most once in it, and the array
validator enforces that.

**Consequence.** A multi-tenant project cannot author one map per tenant in the admin panel. Two
tenants serving `pages` at different patterns have no way to say so.

**Workaround.** [`defineMappings`](./code-defined-mappings.md) per tenant works today, because the
runtime takes mappings as data and never reads the global. Build the map for the tenant a request
belongs to and pass it down; everything downstream behaves identically. Mixing is possible too:
concatenate a tenant-specific code-defined map with the authored one.

The domain or tenant part of resolution is separately your concern. Use `where` on
`resolvePathToDocument` to scope the lookup to a tenant, and `formatHref` to prefix or absolutise
the result.

## Trailing slashes are not normalised

The package matches the path it is given, verbatim. `/journal/hello-world` and
`/journal/hello-world/` are two different paths, and only the first matches
`/journal/:slug`.

**Consequence.** If your framework or CDN serves both forms, one of them 404s.

**Workaround.** Normalise before calling. One line in the catch-all route, applied consistently
with whatever your host does:

```ts
const path = raw.length > 1 ? raw.replace(/\/+$/, "") : "/";
```

Do it in one place. Normalising inside the package would mean picking a convention for every
project, and the projects that want the other convention would have no way out.

## Identifier matching inherits the database collation

Path lookups are ordinary Payload queries. `equals` on an identifier field is resolved by the
database, so whether `/journal/Hello-World` finds the document stored as `hello-world` depends
entirely on the adapter and the column's collation. Postgres is case-sensitive by default; MySQL's
common collations are not; SQLite depends on how the column was declared. The package does not
normalise case in either direction.

**Consequence.** The same content and the same pattern can behave differently across adapters, and
across a development database and a production one. On a case-insensitive collation two documents
whose slugs differ only in case are effectively the same URL, and which one wins is not defined by
anything wayfinder does.

**Workaround.** Normalise slugs on write with a `beforeValidate` hook on the identifier field, so
what is stored is always lowercase, and lowercase the incoming path in the route before calling
`resolvePathToDocument`. That makes behaviour identical everywhere regardless of collation.

## Diagnostics are not deduplicated

`onDiagnostic` fires once per failed call. A page whose footer holds forty links to a misconfigured
collection reports forty times, with the same reason and the same collection each time.

**Consequence.** Logs from a single render can be dominated by one misconfiguration.

**Workaround.** Deduplicating is the caller's job, because the package cannot know which reports
are worth surfacing. A `Set` keyed on the diagnostic's fields, built per request, is usually
enough:

```ts
const seen = new Set<string>();

const onDiagnostic: OnDiagnostic<DiagnosticReason> = (d) => {
  const key = `${d.reason}:${d.collection ?? ""}:${d.param ?? ""}:${d.path ?? ""}`;

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  console.warn("[wayfinder]", key);
};
```

## Only scalar variant fields are typed

`defineLinks` derives each contributed field's type from the `fields` array. It models the scalar
field types and nothing else:

| Field `type`                        | Derived as                                        |
| ----------------------------------- | ------------------------------------------------- |
| `text`, `textarea`, `email`, `code` | `string \| null \| undefined`                     |
| `number`                            | `number \| null \| undefined`                     |
| `checkbox`                          | `boolean \| null \| undefined`                    |
| `date`                              | `string \| null \| undefined`                     |
| `select`, `radio`                   | the union of its own `options`, nullable          |
| `relationship`, `upload`            | `string \| number \| { id } \| null \| undefined` |
| anything else                       | `unknown`                                         |

A `hasMany` field of any of the above holds an array of that type.

**Consequence.** A variant contributing an `array`, a `group`, a `blocks` or a `richText` field
gets `unknown` for it.

**Workaround.** Name the shape with
[`.data<T>()`](./linking.md#fields-this-cannot-type), which replaces the derived type for that
variant while leaving the others alone.

The alternative would be guessing at the richer shapes, which is worse than being unhelpful: a
wrong type here would be believed. Payload's own `generate:types` produces the accurate shapes when
you need them.

## A variant field can shadow a built-in one

The derived link data is the built-in shape intersected with what the variants contribute, and the
variant fields are applied on top. A variant field named `url`, `newTab`, `reference`, `label` or
`type` therefore overrides the built-in property of that name in the derived type.

**Consequence.** A variant contributing `{ name: "url", type: "number" }` makes `link.url` a
number everywhere, including on the `custom` branch that stores a string there. The field also
collides in the stored group, since both live under the same `link` group in Payload.

**Workaround.** Prefix variant field names, or otherwise keep them distinct from the five built-in
ones. The package does not rename them for you, because a silently renamed field is a field whose
stored data no longer matches what was declared.

## Translations only come with the plugin

`wayfinderPlugin` registers the admin messages the mapping global's validators use.
`createMappingGlobal` on its own does not.

**Consequence.** A project that places the global by hand, without the plugin, sees the validation
messages in English regardless of the admin locale. Payload returns the key itself when nothing is
registered, so the package falls back to the English sentence rather than showing an editor a bare
`wayfinder:invalidPath`, but there is no translation.

**Workaround.** Use the plugin, or merge `wayfinderTranslations` into `i18n.translations`
yourself:

```ts
import { wayfinderTranslations } from "@abinnovision/payloadcms-wayfinder/config";

export default buildConfig({
  i18n: { translations: { ...wayfinderTranslations } },
  globals: [createMappingGlobal({ localized: false })],
  // ...
});
```
