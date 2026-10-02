# Limitations

## Not included

| Not included                             | Why                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unpublishing                             | Taking content offline stays a human action in the admin panel.                                                                                                                                                                                            |
| Deleting documents                       | No tool deletes. A custom tool can, and the draft guard does not cover deletes.                                                                                                                                                                            |
| Version history by default               | Off unless an entity sets `versions: true`. `findVersions`, `versionId` and `diffFrom` are not offered otherwise. Old versions then follow `access.readVersions`, which the plugin does not reimplement; see [security.md](./security.md#version-history). |
| Restoring a version                      | With `versions: true`, pass the old version as `versionId` and the latest as `diffFrom` to `getDocument`, then apply the returned patch with `patchDocument`. The result lands as a draft, with `expectedUpdatedAt` and publish blockers in force.         |
| Creating documents in upload collections | A create there needs the file, and no tool carries one. Upload in the admin panel, then edit the fields through MCP.                                                                                                                                       |
| Addressing rich text `upload` nodes      | Their fields depend on the collection the node points at.                                                                                                                                                                                                  |
| Exposing auth collections                | Their documents carry credentials. Refused at startup, read included.                                                                                                                                                                                      |
| `write: "live"` with `localizeStatus`    | Publishing would cover one locale while reporting success, and `_status` would become a per-locale object. Refused at startup.                                                                                                                             |
| Sessions and streaming                   | The endpoint is stateless and answers every request with JSON. `GET` and `DELETE` answer 405.                                                                                                                                                              |

## Known gaps

`publishDocument` publishes every locale, but Payload validates only the locale the publish runs
in. A required field left empty in another locale goes live empty. The admin Publish button
behaves the same way.

The publish-blocker check validates only the locale that was written. It also runs the fields'
`beforeValidate` and `beforeChange` hooks a second time, so a hook with side effects fires twice
per write and once per `validateDocument` call. Keep side effects out of those hooks.

`expectedUpdatedAt` is checked before the write, inside a transaction, but the read does not lock
the row. A change landing between the check and the write is not detected.

Document locks are checked for collection documents only. Payload's global update reads
`overrideLock` before the draft guard can set it, so an MCP write to a global goes through while
someone has the global open in the admin panel.

A global that has never been saved has no `updatedAt`. Its first write must leave
`expectedUpdatedAt` out, because passing one is refused as a concurrent change.

Diffs compare arrays by position, so a reordered block shows up as a series of replace
operations rather than a move.

`admin.hidden` set on a row, collapsible, unnamed group or tab is not applied to the fields inside
it, in the schema or in reads; set it on the fields themselves.

The other security limitations, such as queries through relations and documents populated in rich
text, are listed in [security.md](./security.md#known-limitations).
