# TD3 deep native UI subsystem review

**Baseline:** v0.546.0 TD3 Pass 27. **Goal:** correct demonstrated QML component/type/style defects; preserve web-rendered workspace appearance and existing native shell controls.

## Inventory

- `apps/desktop-qt/CMakeLists.txt` is the canonical QML module source list.
- `qml/Theme.qml` and generated `qml/ThemeTokens.qml` own Desktop appearance color, motion, type scale and accessibility tokens.
- `qml/components` holds the reusable native button, toggle, input, combo, surface and icon components.
- `qml/pages` holds native settings, profile manager, connection and shared WebView-native chrome.
- The full authenticated studio UI is the web renderer embedded by the native Desktop client; do not invent separate per-workspace native QML implementations.

## Verified source defects and corrections

1. `ClusterComboBox.qml` constructed an undeclared `ClusterGlyph`. Replaced with `ClusterChevron.qml`, declared in CMake and styled via Theme; preserve the existing ComboBox label, model, focus and delegate semantics.
2. Native QML labels used raw 9, 10 and 11 px text and 13/14 px unscaled native controls. Added `Theme.scaledFont(baseSize)`, adopted it across native pages and components, and enforce a readable 12 px floor at standard scale.
3. High-contrast native `Surface` disabled its decorative gradient but still used semi-transparent `Theme.surface`. It now renders an opaque semantic surface in high contrast or transparency-off mode.

## Implementation exit checks

- QML type references for project-owned components resolve to files declared in CMake.
- Qt native text sizing is routed through shared accessibility scale; no raw literal font.pixelSize in native QML pages/components.
- High-contrast native surface backgrounds are opaque and suppress decorative gradients.
- Existing web UI state, taskbar layout, People identity and account permissions are untouched.
- Source regression/integration scripts and archive integrity pass. Installed Qt runtime behavior stays on its separately tracked certification roadmap.

## Deferred / not claimed

- A real Qt build, Windows DPI/screenshots, native screen-reader checks and browser-embedded parity require target dependencies and belong to release certification.
- Remaining shared web actions/CSS conflicts require an independent concrete inventory before calling the entire TD3 implementation phase closed.
