# G26 Pass 21: Durable Native Evidence Linking

## Implemented

- Canonical `evidence_for` relationship added to shared workflow schema and metadata.
- Native upload broker admits a strictly typed evidence intent, separate from Project-file creation metadata.
- The transfer journal persists the evidence intent and the verified Project-file finalization receipt.
- After file finalization, Desktop performs the independent, authenticated `/api/projects/:projectId/workflow-links` mutation. The server independently validates and authorizes the file and destination entity.
- Replay after an interrupted relationship response uses the durable file receipt; it does not reopen the local source or reupload bytes.
- Relationship completion requires source/target/project/type/relationship equality from the server response before the transfer is marked complete.
- Link failures are explicit. The Project file remains persisted; retries do not run the original upload again.
- Inherited tests updated to check the new admitted, validated link path instead of asserting the obsolete evidence rejection.

## Limitations

- Source-level only: no linked Qt build or live Windows authentication tests were available.
- No live PostgreSQL or multi-user authorization tests performed.
- Native evidence status is represented through transfer state/errors; a dedicated multi-step progress UI remains future polish.
- Nonretryable authorization errors require a new authorized action rather than automated replay.
- No destructive storage functionality enabled.
