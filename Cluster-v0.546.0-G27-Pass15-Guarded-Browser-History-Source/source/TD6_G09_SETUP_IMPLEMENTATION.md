# TD6 G09 implementation evidence

- The existing G08 first-run system already supported Guided, Quick, Import and Skip Optional paths; G09 **extended**, not replaced, that system.
- The server already implemented `.clusterconfig` allowlisting, stale-preview digest, SERIALIZABLE apply and safe revision history. G09 adds per-setting opt-in and the ability to review pre-import values for fresh selective reapplication.
- Previously `passkeys > 0` and `recoveryCodes > 0` over all Owner IDs could misleadingly mark the entire setup secure. The new pure `ownerSecurityReadiness` requires each non-archived Owner to have both, and returns only counts to the admin.
- Grouped seven-step checklist provides a valid IANA timezone check, required/optional delineation, contextual explanations, navigation to existing Settings surfaces, and a progress indicator.
- Uploads with forbidden envelope fields or unrecognized configuration keys are rejected in the admin UI; the server also applies its authoritative v1 parser and field allowlist.
- Changes in selective file inputs invalidate prior previews and prevent replaying a preview for an altered selection. Review from history also requires preview. No server-side schema or migration changes.
- First-run file read generation prevents a stale asynchronous read from injecting an outdated bundle into a newer setup selection.
