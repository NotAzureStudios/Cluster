# Accessibility settings

Cluster v0.371.0 completes Legal / Privacy / Accessibility roadmap Step 10 by turning the v0.370 accessibility baseline into a user-configurable accessibility profile for both the shared Web/Desktop renderer and the native Qt shell.

This is an engineering accessibility feature set, not WCAG, ADA, EN 301 549, Section 508, or other legal/certification attestation.

## Account-level renderer preferences

The signed-in Cluster profile can store these accessibility preferences:

- Motion: `system`, `full`, `reduced`, or `none`.
- Contrast: `system`, `standard`, or `high`.
- Transparency: `system`, `full`, `reduced`, or `off`.
- Focus indicator: `auto`, `strong`, or `always`.
- Text scale: `default` (100%), `large` (112.5%), `larger` (125%), or `largest` (150%).
- Larger interaction targets.
- Status palette: `default`, `color-vision-safe`, or `monochrome`.

These preferences are part of the existing `/api/me/preferences` profile payload and therefore roam with the authenticated account. The server validates every enum before persistence.

Legacy `userHighContrast`, `userReduceTransparency`, `userAlwaysShowFocus`, and `motionLevel` values remain readable as migration fallbacks. New saves use the explicit preference fields.

## System-aware behavior

When a preference is set to `system`, the renderer follows platform/browser media preferences where the platform exposes them:

- `prefers-reduced-motion`
- `prefers-contrast`
- `forced-colors`
- `prefers-reduced-transparency`

The global accessibility manager listens for changes so a supported operating-system/browser accessibility change can update the current session without requiring an application restart.

Operating-system reduced-motion is treated as a safety floor. Cluster does not deliberately force decorative animation back on when the platform requests reduced motion.

## Text and interaction scaling

Text scaling is applied from the document root rather than zooming individual panels. This lets normal responsive layout continue to reflow at larger sizes.

The 150% option is intentionally included so users are not limited to a token 5–10% increase. Individual tool workspaces remain responsible for responsive layout and overflow handling at larger sizes.

Larger interaction targets increase common button, form, summary, checkbox, and radio target dimensions without changing project data or studio-wide layout settings.

## Contrast and transparency

High contrast strengthens muted text, borders, selection surfaces, and focus boundaries.

Transparency modes are separate from the studio's visual theme:

- `full` keeps normal glass effects.
- `reduced` limits blur intensity.
- `off` removes backdrop blur and forces major panels/dialogs/navigation surfaces opaque.
- `system` follows reduced-transparency preference when the platform exposes one.

This separation means a user can keep the studio theme while disabling visual effects that make the interface harder to read.

## Focus visibility

The focus setting does not remove keyboard focus behavior.

- `auto` keeps the normal shared focus-visible treatment.
- `strong` increases ring width and separation.
- `always` keeps a visible focus indication even when focus followed pointer interaction.

Forced-colors/high-contrast operating-system modes retain their native color handling.

## Status palettes

Cluster does not apply whole-screen color filters for color-vision accessibility. Filters can distort screenshots, media, artwork, builds, and uploaded content.

Instead the status-palette preference changes semantic application colors:

- `default` keeps the normal status colors.
- `color-vision-safe` uses a high-separation blue/orange/vermillion/green palette for success/warning/error/information states.
- `monochrome` removes semantic hue dependence and strengthens non-color treatment on common status pills.

Important state should still have text, icons, borders, labels, or other non-color signals. Palette selection is supplementary, not permission for feature code to encode meaning only in hue.

## Native Qt shell

The Qt shell stores equivalent local accessibility preferences through `DesktopPreferences`:

- motion mode
- contrast mode
- transparency mode
- text scale
- larger targets
- focus indicator
- status palette

Qt 6.11 platform accessibility hints are used for system high-contrast preference. On Windows, the native shell also reads client-area animation and transparency preferences for its system motion/transparency modes. Unsupported platform hints fail conservatively to the normal theme rather than manufacturing a preference.

Common QML controls consume the shared `Theme` accessibility values for target height, font scale, focus-border strength, motion behavior, transparency, and semantic status colors.

## Privacy

Accessibility preferences are ordinary account preferences. They are not treated as health diagnoses and Cluster does not infer disability categories from them.

They remain within the account-preference export/inventory boundary established by the Privacy & Data Control Center.

## Reset behavior

The Accessibility settings page includes a dedicated reset that resets only accessibility-specific controls to system-aware defaults. It does not reset:

- theme
- studio branding
- project settings
- notification choices
- offline work
- privacy consent

## Roadmap boundary

Roadmap Step 10 implements user-facing accessibility settings.

Roadmap Step 11 remains responsible for automated accessibility CI and regression scanning. The existence of these settings does not replace keyboard, semantic, contrast, screen-reader, zoom, and modal regression testing.
