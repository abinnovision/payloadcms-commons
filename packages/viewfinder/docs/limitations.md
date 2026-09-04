# Limitations

## Not included

Each of these was cut on purpose. If one of them lands later, it will be for a stated reason.

| Not included                     | Why                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline editing                   | Viewfinder is the addressing layer a visual editor needs first. Mutating content means owning form patching, validation, undo and conflict handling, none of which addressing requires.                    |
| Any content mutation at all      | The package never writes to a document and never patches form state. Both bridges only read, resolve and post.                                                                                             |
| Automatic per-field addressing   | Would need a content source map: an API change, a virtual field, or an annotation on every element that renders a value. Block ids are already there and cost nothing. `markField` covers the rest opt-in. |
| Client-side live preview         | Montage keys resolver results by object identity, and a deserialised document breaks that. Server-side live preview re-renders on the server, so it holds. See below.                                      |
| Styling and theming              | The overlay is inline-styled with a fixed blue. No class names, no CSS custom properties, no props to change it.                                                                                           |
| Reacting to `hover` and `leave`  | The protocol carries them, but the admin acts only on `select` today. Scrolling the form on every pointer move would fight the editor for control of the scroll position.                                  |
| A generated `data-vf-*` contract | The attribute names are exported constants, not a stable public format. Read them from the package rather than hard-coding the strings.                                                                    |

## Known gaps

Addressing is block-level by default. An id identifies a block row, so a click anywhere inside a
block resolves to that block. Field-level addressing exists but is opt-in, one `markField` call per
element you care about, and it only reaches values you chose to annotate. A block you never marked
is invisible: clicking it resolves to the nearest marked ancestor instead.

The `display: contents` wrapper is a trade-off, not a free win. `<Marked>` wraps a block in an
element with `display: contents` so that marking a block cannot change how it lays out. The cost is
that such an element generates no box of its own, so its `getBoundingClientRect()` is all zeroes
and the overlay measures a `Range` over the wrapper's contents instead. That covers element and
text children alike, but it is an inference: a child that is absolutely positioned or transformed
contributes its own rect to the range, so the resulting box can be larger, offset, or both.
Scrolling has the same shape, which is why the measured box is scrolled to rather than
`Element.scrollIntoView`. A block that already renders a stable root element can spread
`markBlock()` onto it and skip the wrapper, which gives the overlay a real box. Where that is
possible, do it.

Client-side live preview is unsupported when montage renders the tree. Montage keys resolver
results by object identity (`packages/montage/src/resolver/execute.ts`), and `useLivePreview` hands
the page a freshly deserialised document whose every node is a new object, so no resolved data
survives. This is the same rule montage already states as "do not clone a block between resolving
and rendering". Server-side live preview re-renders on the server, which works: the
admin posts an update, a `RefreshRouteOnSave` mounted by the frontend calls `router.refresh()`,
and the route comes back with fresh data. Viewfinder itself is indifferent, since it only needs
the page in an iframe.

Two assumptions about Payload internals hold the whole thing up, and neither is a public contract.
`src/resolve-path.ts` assumes form state is flat-keyed by field path, with a row's id at
`<path>.id` and its type at `<path>.blockType`. `src/admin/element-id.ts` assumes the admin renders
a field wrapper as `id="field-<path with dots as __>"` and a block row as
`id="<parent path with dots as ->-row-<index>"`. Each is isolated to that one file precisely so a
Payload upgrade that changes either convention touches one place. Both fail closed: a convention
that has moved resolves to `undefined` and nothing happens, rather than the wrong row being
revealed.

Block-row DOM ids join path segments with `-`, which a slug containing a dash makes ambiguous to
parse. The admin therefore generates candidate row ids from form state and matches by equality
rather than parsing an id back into a path. Ids are also assumed unique; if two rows somehow carry
the same one, the shallowest path wins, so the result is deterministic but not necessarily the row
you meant.

The overlay is not themeable. It is one inline-styled fixed-position frame with an optional label,
portalled to `document.body` so that a transformed or clipping ancestor cannot shift it away from
the block it outlines. There are no styling hooks, and the label shows the block type and field
name as sent, not a human-readable admin label.
