# Roadmap Pass E — release-candidate polish

Cluster v0.461.0 closes the consolidated UI/responsive roadmap with a maintenance-first release-candidate pass. The goal is not another visual redesign. The goal is to remove compatibility residue that can make the final interface feel inconsistent, reduce cascade debt, and harden the interaction rules established in Passes A through D.

## Interaction cleanup

Routine controls no longer move vertically or scale merely because the pointer crossed them. Focus feedback is boundary-based and uses `:focus-visible` where compatibility layers previously reacted to every focus event. Shared range controls and progress meters no longer use colored halo or glow shadows.

The current Create system and current ColorField implementation are the only supported creation/color interaction contracts. Dead `create-menu-v071` and pre-redesign swatch styling have been removed instead of keeping invisible compatibility code indefinitely.

## Studio color ownership

Studio color is an interaction identity, not a decorative wash. Library viewer highlights, media controls, PDF selection, and focus boundaries use the Studio color where an accent is useful. Selection remains restrained and ordinary data surfaces remain neutral.

## CSS debt ratchet

The release-candidate baseline is regenerated only after all normal design-system and CSS architecture checks pass. v0.461 ratchets the renderer to:

- 6,534 `!important` declarations, down from the 6,576 Phase 1 ceiling;
- 509 gradients, down from 517;
- 1,538 raw CSS colors, down from the 1,576 design-system budget.

These are still legacy-debt numbers, not targets worth celebrating. They are now release-blocking ceilings so future work can only move downward.

## Release verification boundary

Pass E remains compatible with Cluster's local-unattested source workflow. Static architecture, design-system, accessibility, regression, native build, security, packaging, and artifact verification gates are run locally. Browser/device visual acceptance still requires an environment with the built renderer/runtime and remains distinct from static source verification.
