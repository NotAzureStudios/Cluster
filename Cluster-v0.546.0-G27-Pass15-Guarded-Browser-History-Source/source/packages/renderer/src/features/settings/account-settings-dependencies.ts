import type { AccountSettingsDependencies } from "./settings-workspace-contracts";
import { DASHBOARD_WIDGETS } from "../home-widgets/home-widget-model";
import { DashboardCustomizer, useDashboardWidgets } from "../home-widgets/home-dashboard-controller";
import { projectTypeBadge } from "../operations/modules/operations-foundation";
import { appearanceKeys, applyCustomization, userPreferenceSettingsPayload } from "../application/modules/application-foundation";

export const ACCOUNT_SETTINGS_DEPENDENCIES: AccountSettingsDependencies = {
  userPreferenceSettingsPayload,
  DASHBOARD_WIDGETS,
  useDashboardWidgets,
  DashboardCustomizer,
  projectTypeBadge,
  applyCustomization,
  appearanceKeys,
};
