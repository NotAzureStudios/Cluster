import type { StudioSettingsSection } from "../application/application-models";
import type { ClusterSettingsSearchEntry } from "../../components/cluster-settings-search";
import type { StudioSettingsSectionDescriptor } from "./studio-settings-state";

const STUDIO_SETTING_TERMS: Partial<Record<StudioSettingsSection, string>> = {
  identity: "brand logo organization studio name workspace timezone prefix logo appearance",
  domains: "ownership hostname DNS public url verified domain",
  privacy: "privacy data retention notice consent",
  kiosk: "devices kiosk profiles idle touchscreen screen lock",
  studioSystems: "forms policies legal applications onboarding offboarding announcements",
  people: "profile fields workforce employee contact departments",
  departments: "organization leads hierarchy members team manager",
  roles: "permissions grants inheritance access effective security",
  defaults: "project defaults initial tools release gates",
  projectTypes: "presets templates category project identity",
  createFields: "required fields project creation builder",
  customFields: "schema fields types visible required",
  starters: "starter structure folders boards",
  whiteboards: "canvas default width height",
  builds: "build releases approval channels artifact",
  versioning: "semver calendar project version policies",
  qa: "testing gates checks severity test plans",
  automations: "rules events triggers actions",
  workflow: "integrations webhook policy external access",
};

/** Only sections present in the caller's authorized navigation are indexed. */
export function buildStudioSettingsSearchEntries(
  sections: readonly StudioSettingsSectionDescriptor[],
): ClusterSettingsSearchEntry<StudioSettingsSection>[] {
  return sections.map((section) => ({
    id: "studio:" + section.key,
    section: section.key,
    label: section.label,
    description: section.group,
    keywords: STUDIO_SETTING_TERMS[section.key] || "",
  }));
}
