# TD5 P2 managed storage integrity audit

## Confirmed issue and test

The previous local provider used `link(source, partial)` before `rename(partial, projectTarget)` for `materializeToFile()`, silently aliasing canonical and editable Project files to the **same inode**. A user editing the Project's version could corrupt the canonical object and any other files referring to it. The P2 executable fixture creates both files on the same filesystem, checks distinct inode identities and mutates the Project destination; it verifies the canonical data remains identical.

The old local streaming upload returned caller-supplied `checksumSha256` as if independently verified. P2 hashes the stream as it writes a partial file, verifies size and provided digest before publication, and returns the measured hash. Mismatch / invalid digest / wrong size test cases assert failed input cannot replace an existing object and staging files are cleaned.

The old provider swallowed all `readdir` failures and yielded incomplete file inventories. P2 keeps benign missing top-level prefixes but surfaces other errors, detects disappearing nested directories, and rejects a symlinked list prefix. Tests inject a permissions error and concurrent directory disappearance.

## Scope limits

No unconditional deletion path was enabled. Source leaf symlink protection and inventory symlink rejection are only partial: on a concurrent or untrusted filesystem, parent components can still be rebound. `copyFile` and `rename` are not a durable backup or cross-platform generation-fencing protocol. This pass is not a complete file-provider security proof.

## Verification

- `npm run techdebt:td5:p2:storage`: 12/12 pass on Linux Node 22.
- Inherited TD4 script selection: 61/61 pass with a temporary TypeScript development dependency, removed after the run.
- Server TypeScript: zero new normalized diagnostic signatures vs P1; full compilation blocked by missing packages and generated Prisma.
- Native Windows, PostgreSQL and real NAS/S3 acceptance: not executed.
