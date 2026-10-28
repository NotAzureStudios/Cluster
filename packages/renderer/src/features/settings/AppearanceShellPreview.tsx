import type { CSSProperties } from "react";
import { resolveSemanticPalette, resolveVisualContext } from "../../core/visual-system";
import { ClusterIcon } from "../../components/ClusterIcon";
import type { AppTheme, Settings } from "../application/application-models";

export function AppearanceShellPreview({ settings, theme }: { settings: Settings; theme: AppTheme }) {
  const resolvedTheme = theme === "system"
    ? (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  const context = resolveVisualContext(settings);
  const palette = resolveSemanticPalette(resolvedTheme, context.accessibility.highContrast);
  const patternScale = context.backgroundPatternScale === "small" ? 22 : context.backgroundPatternScale === "large" ? 44 : 32;
  // Isolated draft context: an unsaved Appearance edit must not paint the rest of the app.
  const previewStyle = {
    "--cluster-preview-background": palette.background,
    "--cluster-preview-surface": palette.surfaceStrong,
    "--cluster-preview-text": palette.text,
    "--cluster-preview-muted": palette.textMuted,
    "--cluster-preview-border": palette.border,
    "--cluster-taskbar-surface": palette.surfaceStrong,
    "--cluster-sidebar-surface": palette.surfaceStrong,
    "--cluster-visual-surface": palette.surface,
    "--cluster-visual-surface-raised": palette.surfaceStrong,
    "--cluster-visual-border": palette.border,
    "--cluster-visual-text": palette.text,
    "--cluster-visual-text-muted": palette.textMuted,
    "--cluster-visual-selected": palette.accentSurface,
    "--studio-primary": context.studioPrimary,
    "--studio-secondary": context.studioSecondary,
    "--cluster-pattern-percent": `${context.backgroundPatternIntensity}%`,
    "--cluster-pattern-color": "color-mix(in srgb, var(--cluster-visual-text) var(--cluster-pattern-percent), transparent)",
    "--cluster-pattern-scale": `${patternScale}px`,
    "--glass-percent": `${context.glassStrength}%`,
    "--cluster-texture-percent": `${context.surfaceTextureIntensity}%`,
    "--cluster-icon-scale": context.iconSize === "small" ? "0.9" : context.iconSize === "large" ? "1.1" : "1",
    "--cluster-panel-border-opacity": context.accessibility.highContrast ? "1" : context.panelBorders === "minimal" ? "0.42" : context.panelBorders === "defined" ? "1" : "0.72",
    "--radius-lg": `${context.radius + 6}px`,
  } as CSSProperties;
  return <section className="appearance-shell-preview-v10" style={previewStyle}
    data-theme={resolvedTheme} data-background-base={context.backgroundBase}
    data-background-pattern={context.backgroundPattern} data-surface-style={context.surfaceStyle}
    data-sidebar-surface={context.sidebarSurface} data-taskbar-surface={context.taskbarSurface}
    data-taskbar-layout={context.taskbarLayout} data-sidebar-layout={context.sidebarLayout}
    data-sidebar-item-style={context.sidebarItemStyle}
    data-surface-depth={context.surfaceDepth} data-surface-texture={context.surfaceTexture}
    data-high-contrast={context.accessibility.highContrast ? "true" : "false"}
    data-icon-size={context.iconSize} data-panel-borders={context.accessibility.highContrast ? "defined" : context.panelBorders}
    data-scrollbar-style={context.accessibility.highContrast ? "prominent" : context.scrollbarStyle}
    aria-label="Live Cluster appearance preview">
    <header className="appearance-shell-preview__head"><div><strong>Live shell preview</strong><span>Uses the effective visual instance</span></div><small>{theme} · {settings.interfaceDensity || "compact"}</small></header>
    <div className="appearance-shell-preview__frame">
      <aside className="appearance-shell-preview__sidebar">
        <div className="appearance-shell-preview__brand"><span className="appearance-shell-preview__logo">C</span><strong>Cluster</strong></div>
        {(["home", "project", "calendar", "library", "people"] as const).map((icon, index) => <div key={icon} className={`appearance-shell-preview__nav ${index === 3 ? "active" : ""}`}><ClusterIcon name={icon === "people" ? "users" : icon} /><span>{["Home", "Projects", "Calendar", "Library", "People"][index]}</span></div>)}
      </aside>
      <div className="appearance-shell-preview__workspace">
        <div className="appearance-shell-preview__taskbar"><span><ClusterIcon name="chevron-left" /><ClusterIcon name="chevron-right" /></span><div className="appearance-shell-preview__tab active"><i />Project Orion</div><div className="appearance-shell-preview__tab">Cluster</div><span className="appearance-shell-preview__spacer" /><ClusterIcon name="search" /><div className="appearance-shell-preview__avatar">D</div></div>
        <main className="appearance-shell-preview__content">
          <div className="appearance-shell-preview__title"><div><small>LIBRARY</small><strong>Production assets</strong></div><button type="button" tabIndex={-1}>New item</button></div>
          <div className="appearance-shell-preview__cards"><article className="selected"><span /><strong>Environment</strong><small>24 items</small></article><article><span /><strong>Trailer.mov</strong><small>Video · 3.2 GB</small></article><article><span /><strong>Concept Art</strong><small>12 items</small></article></div>
          <div className="appearance-shell-preview__control-row"><div>Search Library</div><button type="button" tabIndex={-1}>Filter</button><button type="button" tabIndex={-1} className="primary">Upload</button></div>
        </main>
      </div>
    </div>
    <footer className="appearance-shell-preview__meta"><span>{settings.backgroundBaseStyle || "clean"}</span><span>{settings.backgroundPattern || "hex"}</span><span>{settings.surfaceStyle || "outlined"}</span><span>{context.sidebarLayout} sidebar</span><span>{context.sidebarItemStyle} navigation</span><span>{context.surfaceDepth} depth</span><span>{context.surfaceTexture} texture</span><span>{context.panelBorders} borders</span><span>{context.iconSize} icons</span><span>{context.taskbarLayout === "floating" ? "Floating" : "Full-width"} taskbar</span><span>{settings.taskbarSurface || "match"} finish</span></footer>
  </section>;
}
