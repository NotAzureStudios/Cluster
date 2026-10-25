pragma Singleton
import QtQuick

QtObject {
    readonly property bool dark: clusterApp.desktopPreferences.appearance === "dark"
                                 || (clusterApp.desktopPreferences.appearance === "system" && Qt.styleHints.colorScheme === Qt.ColorScheme.Dark)
    readonly property string motionMode: clusterApp.desktopPreferences.motionMode
    readonly property string contrastMode: clusterApp.desktopPreferences.contrastMode
    readonly property string transparencyMode: clusterApp.desktopPreferences.transparencyMode
    readonly property bool highContrast: clusterApp.desktopPreferences.highContrast
    readonly property bool compact: clusterApp.desktopPreferences.density === "compact"
    readonly property bool reducedMotion: clusterApp.desktopPreferences.reducedMotion
    readonly property bool noMotion: motionMode === "none"
    readonly property bool reducedTransparency: transparencyMode === "reduced" || transparencyMode === "off" || (transparencyMode === "system" && clusterApp.desktopPreferences.systemReducedTransparency)
    readonly property bool transparencyOff: transparencyMode === "off" || (transparencyMode === "system" && clusterApp.desktopPreferences.systemReducedTransparency)
    readonly property real textScale: clusterApp.desktopPreferences.textScale === "largest" ? 1.5 : clusterApp.desktopPreferences.textScale === "larger" ? 1.25 : clusterApp.desktopPreferences.textScale === "large" ? 1.125 : 1.0
    readonly property bool largeTargets: clusterApp.desktopPreferences.largeTargets
    readonly property string focusIndicator: clusterApp.desktopPreferences.focusIndicator
    readonly property string statusPalette: clusterApp.desktopPreferences.statusPalette

    readonly property color background: dark ? ThemeTokens.backgroundDark : ThemeTokens.backgroundLight
    readonly property color backgroundDeep: dark ? ThemeTokens.backgroundDeepDark : ThemeTokens.backgroundDeepLight
    readonly property color surface: dark ? ThemeTokens.surfaceDark : ThemeTokens.surfaceLight
    readonly property color surfaceStrong: dark ? ThemeTokens.surfaceStrongDark : ThemeTokens.surfaceStrongLight
    readonly property color surfaceMuted: dark ? ThemeTokens.surfaceMutedDark : ThemeTokens.surfaceMutedLight
    readonly property color surfaceHover: dark ? ThemeTokens.surfaceHoverDark : ThemeTokens.surfaceHoverLight
    readonly property color border: highContrast ? (dark ? "#FFFFFF" : "#111827") : (dark ? ThemeTokens.borderDark : ThemeTokens.borderLight)
    readonly property color borderStrong: highContrast ? (dark ? "#FFFFFF" : "#000000") : (dark ? ThemeTokens.borderStrongDark : ThemeTokens.borderStrongLight)
    readonly property color text: dark ? ThemeTokens.textDark : ThemeTokens.textLight
    readonly property color textMuted: highContrast ? text : (dark ? ThemeTokens.textMutedDark : ThemeTokens.textMutedLight)
    readonly property color accent: dark ? ThemeTokens.accentDark : ThemeTokens.accentLight
    readonly property color accentStrong: dark ? ThemeTokens.accentStrongDark : ThemeTokens.accentStrongLight
    readonly property color focusRing: highContrast ? (dark ? "#FFFFFF" : "#000000") : (dark ? ThemeTokens.focusRingDark : ThemeTokens.focusRingLight)
    readonly property color accentSurface: dark ? ThemeTokens.accentSurfaceDark : ThemeTokens.accentSurfaceLight
    readonly property color danger: statusPalette === "monochrome" ? text : statusPalette === "color-vision-safe" ? "#D55E00" : (dark ? ThemeTokens.dangerDark : ThemeTokens.dangerLight)
    readonly property color dangerSurface: dark ? ThemeTokens.dangerSurfaceDark : ThemeTokens.dangerSurfaceLight
    readonly property color success: statusPalette === "monochrome" ? text : statusPalette === "color-vision-safe" ? "#0072B2" : (dark ? ThemeTokens.successDark : ThemeTokens.successLight)
    readonly property color warning: statusPalette === "monochrome" ? text : statusPalette === "color-vision-safe" ? "#E69F00" : (dark ? ThemeTokens.warningDark : ThemeTokens.warningLight)
    readonly property color info: statusPalette === "monochrome" ? text : statusPalette === "color-vision-safe" ? "#009E73" : (dark ? ThemeTokens.infoDark : ThemeTokens.infoLight)
    readonly property color warningSurface: dark ? ThemeTokens.warningSurfaceDark : ThemeTokens.warningSurfaceLight
    // Shared native type scale. Small historical 9–11 px labels become readable captions,
    // and all desktop text follows the user's accessibility text scale.
    function scaledFont(baseSize) {
        return Math.round(Math.max(12, Number(baseSize)) * textScale)
    }
    // Transparent dark surfaces undermine high-contrast and reduced-transparency modes.
    readonly property color opaqueSurface: dark ? "#202B35" : "#FFFFFF"
    readonly property int controlHeight: largeTargets ? Math.max(48, Math.round((compact ? 34 : 38) * textScale)) : Math.round((compact ? 34 : 38) * textScale)
    readonly property int pageSpacing: compact ? 10 : 14
    readonly property int radiusSmall: 8
    readonly property int radius: 11
    readonly property int radiusLarge: 16
    readonly property int sidebarExpanded: 252
    readonly property int sidebarCollapsed: 76
    readonly property int taskbarHeight: 58
}
