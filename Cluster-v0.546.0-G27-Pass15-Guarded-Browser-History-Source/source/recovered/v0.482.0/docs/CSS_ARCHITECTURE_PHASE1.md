# CSS Architecture Cleanup — Phase 1

Phase 1 turns the renderer cascade into an explicitly owned, regression-gated system before larger selector migrations begin.

## Baseline after the first cleanup

- CSS files: 72
- `!important`: 6,576
- `box-shadow` declarations: 621
- gradients: 517
- `backdrop-filter`: 146
- raw color expressions: 1,573

These numbers are debt inventory, not design targets. The architecture audit freezes the highest-risk counts so each verified cleanup can reduce the baseline without later work quietly adding it back.

## Completed in this phase

- Application decomposition modules no longer re-import parent-owned CSS side effects.
- `application-refinements.css` is explicitly a single-owner legacy compatibility barrel.
- The global stylesheet entrypoint documents the cascade ownership/order instead of presenting a flat list of mystery patches.
- Redundant settings slider track/thumb overrides were removed; settings retains only its intentionally larger hit area.
- New renderer CSS architecture documentation defines token, base, compatibility, cross-app, primitive, feature, and production ownership.
- A new `css-architecture-audit.mjs` release gate prevents growth in `!important`, raw colors, decorative gradients, and blur debt.
- New CSS cannot introduce `!important`, raw colors, or `backdrop-filter` debt.
- New patch-named files such as `*-polish.css`, `*-fix.css`, `*-override.css`, and `*-parity.css` are blocked by the audit.

## Highest-priority migration queue

The next selector cleanup should work from the largest forced-override owners downward, but only after verifying each affected workflow:

1. `features/settings/settings-workspace.css`
2. `features/application/styles/refinements-workspaces.css`
3. `features/application/styles/refinements-shell.css`
4. `features/projects/projects.css`
5. `features/application/styles/refinements-controls.css`
6. `features/shell/shell.css`
7. `styles/parity-v344.css`
8. `styles/layers/application-tools.css`

The objective is not to mechanically delete `!important`. It is to migrate each surviving declaration into the selector's actual owner, then remove the compatibility rule entirely.
