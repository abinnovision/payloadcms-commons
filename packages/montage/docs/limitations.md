# Limitations

## Not included

Each of these was cut on purpose. If one of them lands later, it will be for a stated reason. See
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

The context stops being serializable once montage has written to it. The results store is a `Map`
keyed on object identity, and a `Map` keyed that way cannot cross a serialization boundary into a
client component. Pass individual fields rather than the context itself.

`defineBlockRegistry`'s `require` option narrows the missing-component defect without eliminating
it. It can only check what you list, and it cannot see blocks contributed by other plugins, so a
block you forget to list in `require` can still go unregistered with no compile error. [Checking
the config against the registry](./recipes.md#checking-the-config-against-the-registry) derives
that list from your block configs instead of leaving you to maintain it by hand.

The `./config` and `.` entrypoints share no runtime state. TypeScript types are all that join them,
by way of Payload's generated `BlockSlug` and `TypedBlock`. Nothing checks at runtime that what
`montagePlugin` registers in `config.blocks` agrees with what a registry built from `.` actually
defines, though you can derive such a check at the type level (see
[`recipes.md`](./recipes.md#checking-the-config-against-the-registry)). `montagePlugin` does
reject duplicate slugs in the merged `config.blocks`.
