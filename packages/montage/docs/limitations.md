# Limitations

## Not included

Each of these is a deliberate cut, not a gap that will close later without a reason. See
[`recipes.md`](./recipes.md) for how to build the ones you need on top of montage.

| Not included                         | Why                                                                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page, section, and template modeling | These are opinions about your content structure. Montage would model them badly for someone; you know your own shape.                                                                                |
| A reusable/global-block collection   | An ordinary Payload collection, referenced through an ordinary relationship field. Nothing montage-specific is needed.                                                                               |
| Caching and revalidation             | Framework- and infrastructure-specific. `resolveBlockData` has no cache hook beyond the identity-keyed results store; wrap your own resolvers in whatever caching primitive your framework provides. |
| Admin UI components                  | Requires a dependency on `@payloadcms/ui` and an importMap contract. Out of scope while the package has one consumer.                                                                                |
| Client components                    | The renderer is server-only. Nothing prevents your own block components from rendering client components inside themselves.                                                                          |
| CSS                                  | Montage ships no styles and no className conventions.                                                                                                                                                |
| Migration tooling                    | The port from a hand-rolled engine to montage is a one-time, manual exercise; there is no automation for it.                                                                                         |

## Known gaps

- **The context is not serializable once montage has written to it.** The results store is a
  `Map` keyed on object identity, which cannot cross a serialization boundary (into a client
  component, for instance). Pass individual fields, not the context itself.
- **`defineBlockRegistry`'s `require` option narrows the missing-component defect; it does not
  eliminate it.** It can only check what you list, and it cannot see blocks contributed by other
  plugins. A block you forget to list in `require` can still go unregistered without a compile
  error. See [Checking the config against the
  registry](./recipes.md#checking-the-config-against-the-registry) for deriving the list from
  your block configs rather than maintaining it by hand.
- **The `./config` and `.` entrypoints share no runtime state.** They are joined only by
  TypeScript types (Payload's generated `BlockSlug`/`TypedBlock`). There is no runtime cross-check
  between what `montagePlugin` registers in `config.blocks` and what a registry built with `.`
  actually defines, though you can derive one at the type level (see
  [`recipes.md`](./recipes.md#checking-the-config-against-the-registry)). `montagePlugin` does
  reject duplicate slugs in the merged `config.blocks`.
