import { ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ColorField } from "../../components/ColorField";
import { displayUserName } from "../people/people-utils";
import type { Priority, ProjectStatus, ProjectTypePreset, Settings, User } from "../application/application-models";

export function SharedCreateProjectAdvancedOptions({
  projectExternalName,
  setProjectExternalName,
  projectCodename,
  setProjectCodename,
  projectAliases,
  setProjectAliases,
  workspacePresetKey,
  setWorkspacePresetKey,
  projectTypeTemplate,
  setProjectTypeTemplate,
  projectTypeTemplates,
  projectStatus,
  setProjectStatus,
  projectStatusOptions,
  projectPriority,
  setProjectPriority,
  priorityOptions,
  projectStartDate,
  setProjectStartDate,
  projectTargetDate,
  setProjectTargetDate,
  projectObjective,
  setProjectObjective,
  projectClientName,
  setProjectClientName,
  projectTags,
  setProjectTags,
  projectColor,
  setProjectColor,
  selectedProjectType,
  createStarterBoard,
  setCreateStarterBoard,
  createStarterWhiteboard,
  setCreateStarterWhiteboard,
  createStarterLibrary,
  setCreateStarterLibrary,
  projectExternal,
  setProjectExternal,
  settings,
  externalOwnerId,
  setExternalOwnerId,
  createUsers,
}: {
  projectExternalName: string;
  setProjectExternalName: (value: string) => void;
  projectCodename: string;
  setProjectCodename: (value: string) => void;
  projectAliases: string;
  setProjectAliases: (value: string) => void;
  workspacePresetKey: string;
  setWorkspacePresetKey: (value: string) => void;
  projectTypeTemplate: string;
  setProjectTypeTemplate: (value: string) => void;
  projectTypeTemplates: string[];
  projectStatus: ProjectStatus;
  setProjectStatus: (value: ProjectStatus) => void;
  projectStatusOptions: Array<{ value: ProjectStatus; label: string }>;
  projectPriority: Priority;
  setProjectPriority: (value: Priority) => void;
  priorityOptions: Array<{ value: Priority; label: string }>;
  projectStartDate: string;
  setProjectStartDate: (value: string) => void;
  projectTargetDate: string;
  setProjectTargetDate: (value: string) => void;
  projectObjective: string;
  setProjectObjective: (value: string) => void;
  projectClientName: string;
  setProjectClientName: (value: string) => void;
  projectTags: string;
  setProjectTags: (value: string) => void;
  projectColor: string;
  setProjectColor: (value: string) => void;
  selectedProjectType: ProjectTypePreset;
  createStarterBoard: boolean;
  setCreateStarterBoard: (value: boolean) => void;
  createStarterWhiteboard: boolean;
  setCreateStarterWhiteboard: (value: boolean) => void;
  createStarterLibrary: boolean;
  setCreateStarterLibrary: (value: boolean) => void;
  projectExternal: boolean;
  setProjectExternal: (value: boolean) => void;
  settings?: Settings;
  externalOwnerId: string;
  setExternalOwnerId: (value: string) => void;
  createUsers: User[];
}) {
  // Only what you need to start; everything else is in project Settings → Details.
  return <>
    <div className="field"><label>Status</label><ClusterSelect value={projectStatus} onChange={(value) => setProjectStatus(value as ProjectStatus)} ariaLabel="Project status" options={projectStatusOptions} /></div>
    <div className="field"><label>Start date</label><ClusterTextInput type="date" value={projectStartDate} onChange={(event) => setProjectStartDate(event.target.value)} /></div>
    <div className="field"><label>Due date</label><ClusterTextInput type="date" value={projectTargetDate} onChange={(event) => setProjectTargetDate(event.target.value)} /><small>Leave empty for an ongoing project.</small></div>
    <ColorField value={projectColor} onChange={setProjectColor} label="Project color" />
    <label className="tool-check"><ClusterInput type="checkbox" checked={createStarterBoard} onChange={(event) => setCreateStarterBoard(event.target.checked)} /> Starter board</label>
    <label className="tool-check"><ClusterInput type="checkbox" checked={createStarterLibrary} onChange={(event) => setCreateStarterLibrary(event.target.checked)} /> Project folder in Library</label>
  </>;
}
