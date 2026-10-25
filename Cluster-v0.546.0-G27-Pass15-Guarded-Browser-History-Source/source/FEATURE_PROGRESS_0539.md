# Cluster v0.539 | Completed Library Collection journeys

| User journey | Before | Now | Source-level / runtime status |
|---|---|---|---|
| Save "modified in last 7 days" | Saved fixed timestamp and silently aged out | Rolling server-time filter | Focused logic test passed / DB pending |
| Browse >250 Smart Collection matches | Cut off first page | Cursor-paginated results, incremental UI | Cursor behavior tested / browser pending |
| Browse >1,000 manual references | Cut off 1,000 | Incremental paginated membership | Cursor behavior tested / browser pending |
| Save media/visibility/pinned filters | Silently dropped | Serialized into persisted semantic query | Compiler tests passed / browser pending |
| Save folder-scoped view | Folder scope ignored | Exact folder saved, recursive descendants explicitly blocked | Contract tested / browser pending |
| Rename or remove collection during competing edits | Revision checked only before unconditional write | DB mutation revision-qualified | Source check / PostgreSQL pending |
| Sort Custom view | Unsupported by smart sort list | Stored custom sort and stable ID tie breaker | Semantic test / PostgreSQL pending |

No change to native updater or Prisma schema. Certification remains deferred.
