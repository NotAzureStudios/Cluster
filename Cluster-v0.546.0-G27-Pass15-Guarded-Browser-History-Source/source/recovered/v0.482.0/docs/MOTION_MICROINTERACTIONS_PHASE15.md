# Motion & Microinteraction Phase 15

Cluster v0.438.0 treats motion as operational feedback, not decoration. Production workspaces must remain immediately usable even when animation is disabled.

## Motion budget

Motion is allowed when it communicates one of four things:

1. **Spatial change** — a menu, modal, command surface, inspector, or native navigation rail entering/leaving a known location.
2. **State feedback** — pressed, selected, loading, progress, success, warning, error, drag/drop, or explicit reordering.
3. **Continuity** — a control or panel changing size/position in direct response to a user action.
4. **Attention to an active operation** — bounded spinners or skeletons while work is actually in progress.

Motion is not justified merely because content mounted. Whole-page entrances, routine card entrances, filter entrances, board-column staggers, tab-panel entrances, and timeline-item pop-ins are prohibited.

## Duration and easing

Shared tokens are the authority:

- feedback: 100ms
- fast transient surfaces: 120ms
- normal/panel spatial changes: 180ms
- standard easing for continuous state changes
- enter easing for transient surfaces
- exit easing is available for future explicit exit transitions

Feature-local duration values should not multiply when a shared token fits.

## Continuous animation

Infinite animation is reserved for active loading/progress indicators. It must not be used for decorative pulsing, floating, glowing, breathing, background motion, or attention farming. Continuous indicators require an accessible text/status equivalent and must stop under reduced/no-motion preferences.

## Reduced and no motion

The existing accessibility motion contract remains authoritative:

- `data-motion="reduced"` compresses animation/transition duration and removes repeated motion.
- `data-motion="none"` disables animation and transitions.
- system `prefers-reduced-motion` remains a safety floor when the user follows system preferences.
- Qt Desktop native transitions must also honor reduced/no-motion preferences.

Disabling motion must never hide state changes or make controls unusable.

## Interaction rules

- Hover effects may change color/border/elevation but should not make stable data jump around.
- Selected/pressed/loading/error states must remain understandable without animation.
- Drag/drop feedback may move the dragged object or reveal a drop target, but unrelated records should remain stable.
- Modal/menu/search movement must not delay focus or pointer interaction.
- Skeleton shimmer/spinners are allowed only during active loading and must have non-motion fallbacks.
- Staggered entrance animation for collections is prohibited in production workspaces.

## Release boundary

`tools/scripts/motion-microinteractions-phase15-audit.mjs` is release-blocking. It verifies shared motion tokens, removal of decorative entrance patterns, bounded continuous-animation usage, reduced/no-motion coverage, native Qt preference handling, packaging integration, and the v0.438.0 release contract.

This automated gate does not replace manual inspection. Signed production candidates still require a keyboard/pointer smoke pass with Full, Reduced, None, and OS reduced-motion modes, including drag/drop, menus, dialogs, command search, loading surfaces, and desktop sidebar interactions.
