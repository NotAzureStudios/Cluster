import type { SettingsSection } from "../application/application-models";
import { ACCOUNT_SETTINGS_SECTIONS } from "./account-settings-registry";
import type { ClusterSettingsSearchEntry } from "../../components/cluster-settings-search";

/** The setting index is metadata, not a second preference store or a settings API.
 * It includes less-frequent controls even when their UI section is collapsed.
 */
const CONTROLS: readonly ClusterSettingsSearchEntry<SettingsSection>[] = [
  { id: "theme", label: "Color theme", section: "appearance", description: "Dark, Light or System", keywords: "contrast dark mode light mode", targetId: "appearance-theme-v546" },
  { id: "materials", label: "Surface material & background", section: "appearance", keywords: "glass gradient texture corner border pattern", targetId: "appearance-materials-v546" },
  { id: "layout", label: "Layout and navigation appearance", section: "appearance", keywords: "sidebar taskbar docked floating widths", targetId: "appearance-layout-v546" },
  { id: "motion", label: "Animation and motion", section: "appearance", keywords: "reduced motion transitions", targetId: "appearance-motion-v546" },
  { id: "notification-categories", label: "Notification delivery by category", section: "notifications", description: "Toast, native push, both, silent or off", keywords: "inbox approvals system mentions qa work schedule delivery activity", targetId: "account-notification-delivery-v11" },
  { id: "notification-sounds", label: "Notification sounds", section: "notifications", keywords: "volume interface sounds alerts" },
  { id: "quiet-hours", label: "Quiet hours and digest", section: "notifications", keywords: "mute timezone schedule time weekly daily", targetId: "account-quiet-hours-v11" },
  { id: "notification-tools", label: "Tool notification levels", section: "notifications", keywords: "project mutes important events" },
  { id: "profile", label: "Display name and personal profile", section: "profile", keywords: "avatar bio pronouns email phone contact preferred name skills" },
  { id: "privacy", label: "Presence and visibility", section: "privacy", keywords: "invisible available busy focus away" },
  { id: "security-pin", label: "Security PIN", section: "pin", keywords: "keypad protected operations" },
  { id: "sessions", label: "Sessions and devices", section: "privacy", keywords: "revoke signed in security privacy" },
  { id: "start-screen", label: "Default landing screen", section: "navigation", keywords: "start screen launch taskbar" },
  { id: "sidebar", label: "Sidebar and taskbar", section: "navigation", keywords: "pinned shortcuts tabs search" },
  { id: "home-widgets", label: "Home widgets", section: "home", keywords: "dashboard widgets layout" },
  { id: "shortcut", label: "Keyboard shortcuts", section: "shortcuts", keywords: "hotkeys command palette" },
  { id: "accessibility", label: "Accessibility options", section: "accessibility", keywords: "font contrast target size focus reduced motion" },
  { id: "desktop-startup", label: "Desktop startup and tray", section: "desktop", keywords: "launch at login close minimize notification device" },
  { id: "desktop-server", label: "Desktop server connection", section: "desktop", keywords: "host endpoint url" },
  { id: "my-forms", label: "My assigned forms", section: "forms", keywords: "signatures surveys approvals" },
  { id: "my-resources", label: "My licenses and equipment", section: "licenses", keywords: "inventory game keys assignment" },
];

export const ACCOUNT_SETTINGS_SEARCH_ENTRIES: readonly ClusterSettingsSearchEntry<SettingsSection>[] = [
  ...ACCOUNT_SETTINGS_SECTIONS.map((section) => ({
    id: "section:" + section.key,
    label: section.label,
    section: section.key,
    description: section.description,
    keywords: section.domain,
  })),
  ...CONTROLS,
];
