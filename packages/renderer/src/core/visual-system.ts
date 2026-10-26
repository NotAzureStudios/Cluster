import semanticPalette from "../../../shared/appearance/semantic-palette.json";
import {
  readAccessibilitySystemPreferences,
  resolveAccessibilityPreferences,
  type AccessibilityPreferenceInput,
  type AccessibilitySystemPreferences,
} from "./accessibility-preferences";

export type VisualBackgroundBase = "clean" | "gradient" | "aurora" | "midnight";
export type VisualBackgroundPattern = "none" | "hex" | "grid" | "dots";
export type VisualBackgroundPatternScale = "small" | "medium" | "large";
export type VisualSurfaceStyle = "flat" | "outlined" | "glass";
export type VisualShellSurface = "match" | "solid" | "glass";
export type VisualTaskbarLabels = "auto" | "always" | "icons";
export type VisualProjectTabStyle = "compact" | "standard";
/** Placement is independent of the material (solid/glass) and tab density. */
export type VisualTaskbarLayout = "floating" | "full-width";
export type VisualSidebarLayout = "docked" | "floating";
export type VisualSurfaceDepth = "flat" | "soft" | "elevated";
export type VisualSurfaceTexture = "none" | "fine" | "brushed";
export type VisualIconSize = "small" | "standard" | "large";
export type VisualPanelBorders = "minimal" | "subtle" | "defined";
export type VisualScrollbarStyle = "minimal" | "standard" | "prominent";
export type VisualDensity = "dense" | "compact" | "comfortable";
export type VisualFontFamily = "comfortaa" | "inter" | "system" | "mono";

export type VisualSettingsInput = AccessibilityPreferenceInput & {
  studioPrimaryColor?: string;
  studioSecondaryColor?: string;
  dangerColor?: string;
  fontFamily?: VisualFontFamily;
  cornerRadius?: number;
  glassStrength?: number;
  interfaceDensity?: VisualDensity;

  /** Canonical Appearance 3.0 settings. */
  backgroundBaseStyle?: VisualBackgroundBase;
  backgroundPattern?: VisualBackgroundPattern;
  backgroundPatternIntensity?: number;
  backgroundPatternScale?: VisualBackgroundPatternScale;
  surfaceStyle?: VisualSurfaceStyle;
  sidebarSurface?: VisualShellSurface;
  taskbarSurface?: VisualShellSurface;
  taskbarLayout?: VisualTaskbarLayout;
  sidebarLayout?: VisualSidebarLayout;
  surfaceDepth?: VisualSurfaceDepth;
  surfaceTexture?: VisualSurfaceTexture;
  surfaceTextureIntensity?: number;
  iconSize?: VisualIconSize;
  panelBorders?: VisualPanelBorders;
  scrollbarStyle?: VisualScrollbarStyle;
  userTaskbarLabels?: VisualTaskbarLabels;
  projectTabStyle?: VisualProjectTabStyle;

  /** Existing settings still consumed while the visual migration reaches every workspace. */
  backgroundStyle?: "aurora" | "clean" | "grid" | "midnight";
  cardStyle?: VisualSurfaceStyle;
  sidebarStyle?: "solid" | "glass";
  userReducedContrast?: boolean;
  userShowHelpText?: boolean;
};

export type VisualInstanceLayer = {
  id: string;
  parentId?: string;
  overrides: Partial<VisualSettingsInput>;
};

/**
 * Cluster's master visual instance. Component families consume the resolved
 * context instead of carrying copied theme values. Studio/user/device layers
 * may override only the exposed VisualSettingsInput parameters.
 */
export const CLUSTER_VISUAL_MASTER: Readonly<VisualSettingsInput> = Object.freeze({
  studioPrimaryColor: "#57c1ff",
  studioSecondaryColor: "#8ae7ff",
  fontFamily: "comfortaa",
  cornerRadius: 10,
  glassStrength: 58,
  interfaceDensity: "compact",
  backgroundBaseStyle: "clean",
  backgroundPattern: "hex",
  backgroundPatternIntensity: 4,
  backgroundPatternScale: "medium",
  surfaceStyle: "outlined",
  sidebarSurface: "match",
  taskbarSurface: "match",
  taskbarLayout: "floating",
  sidebarLayout: "docked",
  surfaceDepth: "soft",
  surfaceTexture: "fine",
  surfaceTextureIntensity: 6,
  iconSize: "standard",
  panelBorders: "subtle",
  scrollbarStyle: "standard",
  userTaskbarLabels: "auto",
  projectTabStyle: "standard",
});

export const VISUAL_INSTANCE_PARAMETERS = Object.freeze([
  "studioPrimaryColor", "studioSecondaryColor", "dangerColor", "fontFamily",
  "cornerRadius", "glassStrength", "interfaceDensity", "backgroundBaseStyle",
  "backgroundPattern", "backgroundPatternIntensity", "backgroundPatternScale",
  "surfaceStyle", "sidebarSurface", "taskbarSurface", "taskbarLayout", "sidebarLayout", "surfaceDepth", "surfaceTexture", "surfaceTextureIntensity", "iconSize", "panelBorders", "scrollbarStyle", "userTaskbarLabels",
  "projectTabStyle",
] as const);

/**
 * Resolve the final requested layer through a bounded, explicit parent graph.
 * `cluster-visual-master` is the virtual root. Unrelated sibling overrides are
 * deliberately not mixed into the selected instance.
 */
export function resolveVisualInstance(
  base: VisualSettingsInput = CLUSTER_VISUAL_MASTER,
  ...layers: VisualInstanceLayer[]
): VisualSettingsInput {
  if (layers.length > 32) throw new Error("Visual instance chain exceeds 32 layers");
  if (layers.length === 0) return { ...base };
  const byId = new Map<string, VisualInstanceLayer>();
  for (const layer of layers) {
    if (!layer.id || layer.id === "cluster-visual-master" || byId.has(layer.id)) {
      throw new Error(`Duplicate or reserved visual instance id: ${layer.id}`);
    }
    byId.set(layer.id, layer);
  }
  const visited = new Set<string>();
  const chain: VisualInstanceLayer[] = [];
  let id: string | undefined = layers[layers.length - 1].id;
  while (id && id !== "cluster-visual-master") {
    if (visited.has(id)) throw new Error(`Visual instance inheritance cycle at ${id}`);
    visited.add(id);
    const layer = byId.get(id);
    if (!layer) throw new Error(`Unknown visual instance parent: ${id}`);
    chain.push(layer);
    id = layer.parentId || "cluster-visual-master";
  }
  return chain.reverse().reduce<VisualSettingsInput>((resolved, layer) => ({ ...resolved, ...layer.overrides }), { ...base });
}

export type EffectiveVisualContext = {
  studioPrimary: string;
  studioSecondary: string;
  userAccent: string;
  danger: string | null;
  fontFamily: VisualFontFamily;
  radius: number;
  glassStrength: number;
  density: VisualDensity;
  backgroundBase: VisualBackgroundBase;
  backgroundPattern: VisualBackgroundPattern;
  backgroundPatternIntensity: number;
  backgroundPatternScale: VisualBackgroundPatternScale;
  surfaceStyle: VisualSurfaceStyle;
  sidebarSurface: VisualShellSurface;
  taskbarSurface: VisualShellSurface;
  taskbarLayout: VisualTaskbarLayout;
  sidebarLayout: VisualSidebarLayout;
  surfaceDepth: VisualSurfaceDepth;
  surfaceTexture: VisualSurfaceTexture;
  surfaceTextureIntensity: number;
  iconSize: VisualIconSize;
  panelBorders: VisualPanelBorders;
  scrollbarStyle: VisualScrollbarStyle;
  taskbarLabels: VisualTaskbarLabels;
  projectTabStyle: VisualProjectTabStyle;
  accessibility: ReturnType<typeof resolveAccessibilityPreferences>;
  reducedContrast: boolean;
  helpTextVisible: boolean;
};

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

/** Contrast uses WCAG relative luminance, not a fixed brightness threshold. */
function colorLuminance(value: string): number | null {
  const match = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function themeContrastColor(value?: string, dark = "#07111f", light = "#ffffff") {
  const background = colorLuminance(String(value || ""));
  const darkLuminance = colorLuminance(dark);
  const lightLuminance = colorLuminance(light);
  if (background === null || darkLuminance === null || lightLuminance === null) return light;
  const ratio = (foreground: number) => (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
  return ratio(darkLuminance) >= ratio(lightLuminance) ? dark : light;
}

export function normalizeClusterAccent(value: string | null | undefined, fallback: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["#39c9f4", "#18b9e7", "#4f72e8", "#3f60cf", "#2f80ed", "#526dc6", "#6178c7", "#8da0e8", "#2563eb", "#1d4ed8"].includes(normalized)) return "#57c1ff";
  if (["#8ae7ff", "#60a5fa", "#38bdf8", "#0ea5e9"].includes(normalized)) return "#8ae7ff";
  return value as string;
}

function backgroundBaseFromInput(settings: VisualSettingsInput): VisualBackgroundBase {
  if (settings.backgroundBaseStyle) return choice(settings.backgroundBaseStyle, ["clean", "gradient", "aurora", "midnight"] as const, "clean");
  if (settings.backgroundStyle === "aurora" || settings.backgroundStyle === "midnight" || settings.backgroundStyle === "clean") return settings.backgroundStyle;
  return "clean";
}

function backgroundPatternFromInput(settings: VisualSettingsInput): VisualBackgroundPattern {
  if (settings.backgroundPattern) return choice(settings.backgroundPattern, ["none", "hex", "grid", "dots"] as const, "hex");
  if (settings.backgroundStyle === "grid") return "grid";
  return "hex";
}

export function resolveVisualContext(
  settings: VisualSettingsInput,
  personalAccentColor?: string | null,
  systemPreferences: AccessibilitySystemPreferences = readAccessibilitySystemPreferences(),
): EffectiveVisualContext {
  const instance = resolveVisualInstance(CLUSTER_VISUAL_MASTER, {
    id: "runtime-settings",
    parentId: "cluster-visual-master",
    overrides: {
      ...settings,
      // Canonicalize the old background contract before master defaults can mask it.
      backgroundBaseStyle: backgroundBaseFromInput(settings),
      backgroundPattern: backgroundPatternFromInput(settings),
    },
  });
  const studioPrimary = normalizeClusterAccent(instance.studioPrimaryColor, "#57c1ff");
  const studioSecondary = normalizeClusterAccent(instance.studioSecondaryColor, "#8ae7ff");
  const userAccent = normalizeClusterAccent(personalAccentColor, studioPrimary);
  const accessibility = resolveAccessibilityPreferences(instance, systemPreferences);
  const requestedSurface = choice(instance.surfaceStyle ?? instance.cardStyle, ["flat", "outlined", "glass"] as const, "outlined");
  const surfaceStyle: VisualSurfaceStyle = requestedSurface === "glass" && accessibility.transparency === "off" ? "outlined" : requestedSurface;

  const requestedSidebar = choice(instance.sidebarSurface ?? instance.sidebarStyle, ["match", "solid", "glass"] as const, "match");
  const requestedTaskbar = choice(instance.taskbarSurface, ["match", "solid", "glass"] as const, "match");
  const constrainShellSurface = (value: VisualShellSurface): VisualShellSurface => value === "glass" && accessibility.transparency === "off" ? "solid" : value;

  return {
    studioPrimary,
    studioSecondary,
    userAccent,
    danger: instance.dangerColor || null,
    fontFamily: choice(instance.fontFamily, ["comfortaa", "inter", "system", "mono"] as const, "comfortaa"),
    radius: clamp(instance.cornerRadius, 2, 24, 10),
    glassStrength: clamp(instance.glassStrength, 20, 95, 58),
    density: choice(instance.interfaceDensity, ["dense", "compact", "comfortable"] as const, "compact"),
    backgroundBase: backgroundBaseFromInput(instance),
    backgroundPattern: backgroundPatternFromInput(instance),
    backgroundPatternIntensity: clamp(instance.backgroundPatternIntensity, 0, 12, 4),
    backgroundPatternScale: choice(instance.backgroundPatternScale, ["small", "medium", "large"] as const, "medium"),
    surfaceStyle,
    sidebarSurface: constrainShellSurface(requestedSidebar),
    taskbarSurface: constrainShellSurface(requestedTaskbar),
    taskbarLayout: choice(instance.taskbarLayout, ["floating", "full-width"] as const, "floating"),
    sidebarLayout: choice(instance.sidebarLayout, ["docked", "floating"] as const, "docked"),
    surfaceDepth: choice(instance.surfaceDepth, ["flat", "soft", "elevated"] as const, "soft"),
    surfaceTexture: choice(instance.surfaceTexture, ["none", "fine", "brushed"] as const, "fine"),
    surfaceTextureIntensity: clamp(instance.surfaceTextureIntensity, 0, 20, 6),
    iconSize: choice(instance.iconSize, ["small", "standard", "large"] as const, "standard"),
    panelBorders: choice(instance.panelBorders, ["minimal", "subtle", "defined"] as const, "subtle"),
    scrollbarStyle: choice(instance.scrollbarStyle, ["minimal", "standard", "prominent"] as const, "standard"),
    taskbarLabels: choice(instance.userTaskbarLabels, ["auto", "always", "icons"] as const, "auto"),
    projectTabStyle: choice(instance.projectTabStyle, ["compact", "standard"] as const, "standard"),
    accessibility,
    reducedContrast: instance.userReducedContrast === true,
    helpTextVisible: instance.userShowHelpText === true,
  };
}

/** A single semantic source feeds renderer CSS variables and generated Qt chrome tokens. */
export type SemanticPaletteMode = "dark" | "light";
export type SemanticPalette = typeof semanticPalette.dark;

export function resolveSemanticPalette(mode: SemanticPaletteMode, highContrast = false): SemanticPalette {
  const base = semanticPalette[mode];
  return {
    ...base,
    border: highContrast ? (mode === "dark" ? "#FFFFFF" : "#111827") : base.border,
    borderStrong: highContrast ? (mode === "dark" ? "#FFFFFF" : "#000000") : base.borderStrong,
    textMuted: highContrast ? base.text : base.textMuted,
  };
}

export function applySemanticPalette(
  root: Pick<HTMLElement, "style">,
  mode: SemanticPaletteMode,
  highContrast = false,
): void {
  const palette = resolveSemanticPalette(mode, highContrast);
  for (const [name, value] of Object.entries(palette)) {
    root.style.setProperty(`--cluster-semantic-${name.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`, value);
  }
}

export function applyVisualContext(root: HTMLElement, context: EffectiveVisualContext) {
  const { accessibility } = context;
  applySemanticPalette(root, root.dataset.theme === "light" ? "light" : "dark", accessibility.highContrast);
  const patternScalePx = context.backgroundPatternScale === "small" ? 22 : context.backgroundPatternScale === "large" ? 44 : 32;

  root.style.setProperty("--studio-primary", context.studioPrimary);
  root.style.setProperty("--studio-primary-contrast", themeContrastColor(context.studioPrimary));
  root.style.setProperty("--studio-secondary", context.studioSecondary);
  root.style.setProperty("--studio-secondary-contrast", themeContrastColor(context.studioSecondary));
  root.style.setProperty("--user-accent", context.userAccent);
  root.style.setProperty("--accent", context.studioPrimary);
  root.style.setProperty("--accent-contrast", themeContrastColor(context.studioPrimary));
  root.style.setProperty("--accent-2", context.studioSecondary);
  root.style.setProperty("--accent-2-contrast", themeContrastColor(context.studioSecondary));
  if (context.danger) {
    root.style.setProperty("--danger", context.danger);
    root.style.setProperty("--danger-contrast", themeContrastColor(context.danger));
  }

  root.style.setProperty("--radius-sm", `${Math.max(2, context.radius - 6)}px`);
  root.style.setProperty("--radius-md", `${context.radius}px`);
  root.style.setProperty("--radius-lg", `${context.radius + 6}px`);
  root.style.setProperty("--glass-alpha", String(context.glassStrength / 100));
  root.style.setProperty("--glass-percent", `${context.glassStrength}%`);
  root.style.setProperty("--glass-blur", `${Math.round(8 + (context.glassStrength / 100) * 18)}px`);
  root.style.setProperty("--cluster-pattern-opacity", String(context.backgroundPatternIntensity / 100));
  root.style.setProperty("--cluster-pattern-percent", `${context.backgroundPatternIntensity}%`);
  root.style.setProperty("--cluster-pattern-scale", `${patternScalePx}px`);
  root.style.setProperty("--cluster-texture-percent", `${context.surfaceTextureIntensity}%`);
  root.style.setProperty("--cluster-icon-scale", context.iconSize === "small" ? "0.9" : context.iconSize === "large" ? "1.1" : "1");
  root.style.setProperty("--cluster-panel-border-opacity", context.accessibility.highContrast ? "1" : context.panelBorders === "minimal" ? "0.42" : context.panelBorders === "defined" ? "1" : "0.72");

  root.dataset.font = context.fontFamily;
  root.dataset.density = context.density;
  root.dataset.backgroundBase = context.backgroundBase;
  root.dataset.backgroundPattern = context.backgroundPattern;
  root.dataset.surfaceStyle = context.surfaceStyle;
  root.dataset.sidebarSurface = context.sidebarSurface;
  root.dataset.taskbarSurface = context.taskbarSurface;
  root.dataset.taskbarLayout = context.taskbarLayout;
  root.dataset.sidebarLayout = context.sidebarLayout;
  root.dataset.surfaceDepth = context.surfaceDepth;
  root.dataset.surfaceTexture = context.surfaceTexture;
  root.dataset.iconSize = context.iconSize;
  root.dataset.panelBorders = context.accessibility.highContrast ? "defined" : context.panelBorders;
  root.dataset.scrollbarStyle = context.accessibility.highContrast ? "prominent" : context.scrollbarStyle;
  root.dataset.taskbarLabels = context.taskbarLabels;
  root.dataset.projectTabStyle = context.projectTabStyle;

  // Existing selectors are intentionally fed by the resolved authority while the
  // component CSS migrates to the canonical data attributes above.
  root.dataset.background = context.backgroundPattern === "grid" ? "grid" : context.backgroundBase === "gradient" ? "clean" : context.backgroundBase;
  root.dataset.cardStyle = context.surfaceStyle;
  root.dataset.sidebarStyle = context.sidebarSurface === "match" ? (context.surfaceStyle === "glass" ? "glass" : "solid") : context.sidebarSurface;

  root.dataset.motionPreference = accessibility.motionPreference;
  root.dataset.motion = accessibility.motion;
  root.dataset.largeTargets = accessibility.largeTargets ? "true" : "false";
  root.dataset.reducedContrast = context.reducedContrast ? "true" : "false";
  root.dataset.contrastPreference = accessibility.contrastPreference;
  root.dataset.highContrast = accessibility.highContrast ? "true" : "false";
  root.dataset.transparencyPreference = accessibility.transparencyPreference;
  root.dataset.transparency = accessibility.transparency;
  root.dataset.reduceTransparency = accessibility.transparency !== "full" ? "true" : "false";
  root.dataset.focusIndicator = accessibility.focusIndicator;
  root.dataset.alwaysShowFocus = accessibility.focusIndicator === "always" ? "true" : "false";
  root.dataset.textScale = accessibility.textScale;
  root.dataset.statusPalette = accessibility.statusPalette;
  root.dataset.helpText = context.helpTextVisible ? "visible" : "hidden";
}
