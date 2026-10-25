# G26 Pass 17 | Strict Desktop transfer journal and cancellation cleanup

Parent: v0.546.0 G26 Pass 16. Source-level implementation, not a linked Qt runtime build.

## Closed source gap

Earlier load code validated JSON shape, version and duplicate IDs, but then trusted each entry's direction, state, numeric byte counts and disk paths. That meant a locally damaged queue could point resumption or cancellation at unexpected paths. The download commit receipt could also have a shorter, volatile progress counter if the last response bytes were consumed at `finished` instead of `readyRead`.

- Adds Qt-free `DesktopTransferJournalPolicy.h` with allowed states/directions, exact JSON integer limits, SHA-256 format and verified final/`.cluster-part` sibling relationship.
- `TransferManager::load()` now validates each record BEFORE queue admission, including types, absolute paths, download remote path, byte ranges, and completed download intent. Any bad record holds the entire queue in `journal-invalid` state rather than dropping an individual job or silently rewriting the source.
- Limits journal reads and writes to 16 MiB; oversized files fail closed instead of consuming arbitrarily large memory. Existing atomic writer and explicit recovery remain intact.
- Automatic cancellation cleanup only removes a regular nonsymlink `.cluster-part` sibling inside the active Downloads directory. Historical/unrecognized paths are retained rather than guessed. This does not replace file-ID based Windows race hardening.
- Before saving verified `committing` intent, records full verified byte length even if the last network fragment arrived through `finished`, so a legitimate recovery record won't be rejected by the stricter byte-count validator.
- Tests: 45 executable portable C++ policy assertions + 24 connected source assertions, and inherited native Qt source suites.

Not completed: full native Qt runtime, concurrent filesystem race acceptance, browser/mobile parity and complete Release certification. G26-08/09 remain source-partial.
