import { readPreferenceStorage } from "../../../core/privacy-consent";
import { applySemanticPalette, applyVisualContext, resolveVisualContext } from "../../../core/visual-system";
import type { AppTheme, Settings, User } from "../application-models";

export const MAX_PROJECT_TABS = 12;
export const THEME_STORAGE_KEY = "cluster-theme-mode";

export function userPreferencesFromUser(user?: User | null): Partial<Settings> {
  return user?.preferences && typeof user.preferences === "object" ? (user.preferences as Partial<Settings>) : {};
}

export function getStoredTheme(): AppTheme {
  const stored = readPreferenceStorage(THEME_STORAGE_KEY);
  return stored === "dark" || stored === "light" || stored === "system" ? stored : "dark";
}

export function applyTheme(theme: AppTheme) {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = theme;
  applySemanticPalette(document.documentElement, resolved, document.documentElement.dataset.highContrast === "true");
}

export function applyCustomization(settings: Partial<Settings>, personalAccentColor?: string | null) {
  const context = resolveVisualContext(settings, personalAccentColor);
  applyVisualContext(document.documentElement, context);
}
