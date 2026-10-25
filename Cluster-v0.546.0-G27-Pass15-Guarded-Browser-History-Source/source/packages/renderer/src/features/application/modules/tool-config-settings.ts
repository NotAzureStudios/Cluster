import { clusterToolSettingsPatch as canonicalToolSettingsPatch } from "@cluster/shared";
import type { ToolKey } from "../../admin/AdminToolControls";
import type { Settings } from "../application-models";

export function toolConfigSettingsPatch(tool: ToolKey, config: Record<string, any>): Partial<Settings> {
  return canonicalToolSettingsPatch(tool, config) as Partial<Settings>;
}
