# @abinnovision/payloadcms-mcpx

Payload CMS plugin that mounts an MCP server with a fixed, schema-aware tool
surface: schemas are pulled on demand instead of pushed into `tools/list`,
writes are RFC 6902 patches that always land as drafts, every write returns the
list of publish blockers, and each API key carries its own capability switches.

Work in progress. The package is being built in phases; see the repository root
for status.
