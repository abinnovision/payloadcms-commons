# Limitations

## Not included

Each of these was cut on purpose. If one of them lands later, it will be for a stated reason.

| Not included                     | Why                                                                                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline editing                   | Viewfinder is the addressing layer a visual editor needs first. Mutating content means owning form patching, validation, undo and conflict handling, none of which addressing requires.                                            |
| Any content mutation at all      | The package never writes to a document and never patches form state. Both bridges only read, resolve and post.                                                                                                                     |
| Automatic per-field addressing   | Would need a content source map: an API change, a virtual field, or an annotation on every element that renders a value. Block ids are already there and cost nothing. `markField` covers the rest opt-in.                         |
| Client-side live preview         | Montage keys resolver results by object identity, and a deserialised document breaks that. Server-side live preview re-renders on the server, so it holds. See below.                                                              |
| Styling and theming              | The preview badge and the admin row button are inline-styled with a fixed blue. No class names, no CSS custom properties, no props to change either.                                                                               |
| Reacting to `hover` and `leave`  | The protocol carries them (deduplicated, so one message per block rather than one per pointer move), but the admin acts only on `select`. Scrolling the form as the pointer sweeps would fight the editor for the scroll position. |
| A generated `data-vf-*` contract | The attribute names are exported constants, not a stable public format. Read them from the package rather than hard-coding the strings.                                                                                            |

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

The overlay is not themeable. It is one inline-styled fixed-position frame with an inert badge,
portalled to `document.body` so that a transformed or clipping ancestor cannot shift it away from
the block it outlines. The badge takes no pointer events; the block underneath is the click
target. There are no styling hooks, and the badge shows the block
type and field name as sent, not a human-readable admin label.

The admin's row button is portalled into a Payload class name, `.blocks-field__block-header`. That
is a third undocumented assumption alongside the two above, and it fails closed in the same way: if
the class moves, no button is found and no button is rendered. It is refreshed by a
`MutationObserver` on the document, because rows mount and unmount as the editor expands and
collapses them and expanding changes no form state, so a render-driven scan would miss it. The
scan is skipped entirely when no preview frame is present.

Revealing a row waits for Payload to render it. Payload wraps a row's fields in
`RenderIfInViewport`, which mounts them only once the wrapper comes within 1000px of the viewport,
so expanding an ancestor is not enough on its own: each ancestor is scrolled into view as it is
expanded, which is what brings the next level down inside that margin. The wait for each level is
about a second, after which the reveal gives up and nothing happens. A form deep enough that a
level takes longer than that to render would fail silently.
