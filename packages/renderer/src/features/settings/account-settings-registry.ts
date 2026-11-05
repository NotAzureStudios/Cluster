import type { SettingsSection } from "../application/application-models";

export type AccountSettingsDomain =
  | "Identity"
  | "Privacy & Security"
  | "Notifications"
  | "Appearance & Layout"
  | "Performance"
  | "Navigation"
  | "Accessibility"
  | "Device"
  | "Studio Resources";

export const ACCOUNT_SETTINGS_SECTIONS = [
  { key: "profile", label: "Profile", description: "Identity, contact details, bio, and what other people can see.", domain: "Identity", order: 10 },
  { key: "privacy", label: "Privacy & data", description: "Personal data, privacy choices, connected identity, sessions, and presence.", domain: "Privacy & Security", order: 20 },
  { key: "pin", label: "Security PIN", description: "Create or change the PIN used for protected actions.", domain: "Privacy & Security", order: 30 },
  { key: "notifications", label: "Notifications", description: "Inbox delivery, reminders, quiet hours, and project controls.", domain: "Notifications", order: 40 },
  { key: "appearance", label: "Appearance", description: "Theme, typography, surfaces, density, and personal color.", domain: "Appearance & Layout", order: 50 },
  { key: "performance", label: "Performance", description: "Device rendering quality, hardware-aware effects, and diagnostics.", domain: "Performance", order: 55 },
  { key: "navigation", label: "Navigation", description: "Landing screen, taskbar labels, search, and pinned tools.", domain: "Navigation", order: 60 },
  { key: "home", label: "Home", description: "Choose the widgets and density used on Home.", domain: "Appearance & Layout", order: 70 },
  { key: "shortcuts", label: "Shortcuts", description: "Keyboard profile, command palette shortcut, and filters.", domain: "Navigation", order: 80 },
  { key: "accessibility", label: "Accessibility", description: "Motion, target size, focus behavior, and contrast options.", domain: "Accessibility", order: 90 },
  { key: "desktop", label: "Desktop & device", description: "Desktop startup, tray, close, links, and notifications.", domain: "Device", order: 100 },
  { key: "forms", label: "My forms", description: "Assigned forms, responses, and review outcomes.", domain: "Studio Resources", order: 105 },
  { key: "licenses", label: "My resources", description: "Your equipment, license seats, and PIN-protected game keys.", domain: "Studio Resources", order: 110 },
] as const satisfies ReadonlyArray<{
  key: SettingsSection;
  label: string;
  description: string;
  domain: AccountSettingsDomain;
  order: number;
}>;

export type AccountSettingsSectionDefinition = (typeof ACCOUNT_SETTINGS_SECTIONS)[number];

export function buildAccountSettingsSections(meta: Record<SettingsSection, string>) {
  return ACCOUNT_SETTINGS_SECTIONS.map((section) => ({
    key: section.key,
    label: section.label,
    description: section.description,
    domain: section.domain,
    meta: meta[section.key],
  }));
}
