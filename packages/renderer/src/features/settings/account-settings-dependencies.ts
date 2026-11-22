import type { AccountSettingsDependencies } from "./settings-workspace-contracts";
import { projectTypeBadge } from "../operations/modules/operations-foundation";
import { appearanceKeys, applyCustomization, userPreferenceSettingsPayload } from "../application/modules/application-foundation";

export const ACCOUNT_SETTINGS_DEPENDENCIES: AccountSettingsDependencies = {
  userPreferenceSettingsPayload,
  projectTypeBadge,
  applyCustomization,
  appearanceKeys,
};
