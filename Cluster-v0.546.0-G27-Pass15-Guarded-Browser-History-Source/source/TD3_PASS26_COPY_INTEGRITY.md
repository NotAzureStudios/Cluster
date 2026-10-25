# Cluster TD3 Pass 26 | Clipboard and sensitive copy actions

Parent: v0.546.0 TD3 Pass 25. Implementation only; TD1 and TD2 remain implementation-closed and release certification is tracked separately.

## Defects resolved

- The Desktop clipboard capability returns a **boolean**; the canonical `copyClusterText` incorrectly treated a resolved `false` as success. It now accepts explicit native success and otherwise falls back to the browser clipboard, reporting failure only when both fail. Browser clipboard absence does not produce a false success.
- Introduced `ClusterCopyButton`, a shared, accessible copy command with **synchronous duplicate-activation lock**, visible copy pending/success/failure states, and text-generation ownership. A late copy completion cannot mark a newly rotated credential as copied.
- Migrated one-time MFA recovery codes, scoped API/webhook signing credentials, new-account temporary passwords, People/quick-profile Discord contact actions, and restricted partner link copies to the shared control. Native Desktop clipboard is supported without a new dependency.
- People profile link and mention commands now check real clipboard success instead of treating optional chaining as a successful write on devices with no Clipboard API.
- ClusterDataTable copy-selected-rows and focused-cell shortcuts now report actual copy failure rather than claiming data was copied when the write was blocked.

## Security and preservation

The copy control **never echoes secrets in feedback**, logs, or telemetry. The OS clipboard can retain copied passwords or codes until replaced; the UI does not promise to erase them. Existing user-color avatar borders, separate presence dots, project-only taskbar tabs, animated tab-area search, My Work, Tickets, Transfer Center, floating/docked taskbar/sidebar modes, and Appearance options remain unchanged.

## Boundaries

Source implementation plus executable clipboard behavior simulations, targeted code-contract assertions, inherited development tests, source parsing/import/CSS checks and illustrative source-CSS previews. These are not an authenticated React/Qt runtime or Windows release certification. Other non-sensitive copy actions outside this pass may retain their existing behavior until audited.
