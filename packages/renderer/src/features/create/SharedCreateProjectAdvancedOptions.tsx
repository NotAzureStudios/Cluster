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
  return <>
    <div className="field full"><label>External / public name</label><ClusterTextInput value={projectExternalName} onChange={(event) => setProjectExternalName(event.target.value)} placeholder="Optional partner-safe or public-facing name" /></div>
    <div className="field"><label>Codename</label><ClusterTextInput value={projectCodename} onChange={(event) => setProjectCodename(event.target.value)} placeholder="Optional internal codename" /></div>
    <div className="field"><label>Aliases / previous names</label><ClusterTextInput value={projectAliases} onChange={(event) => setProjectAliases(event.target.value)} placeholder="Comma-separated" /></div>
    <div className="field"><label>Status</label><ClusterSelect value={projectStatus} onChange={(value) => setProjectStatus(value as ProjectStatus)} ariaLabel="Project status" options={projectStatusOptions} /></div>
    <div className="field"><label>Workspace preset</label><ClusterSelect value={workspacePresetKey} onChange={setWorkspacePresetKey} ariaLabel="Workspace preset" options={[{ value: "standard", label: "Standard" }, { value: "production", label: "Production-heavy" }, { value: "lightweight", label: "Lightweight" }]} /></div>
    {projectTypeTemplates.length ? <div className="field full"><label>Blueprint</label><ClusterSelect value={projectTypeTemplate} onChange={setProjectTypeTemplate} ariaLabel="Project Blueprint" options={projectTypeTemplates.map((template) => ({ value: template, label: template }))} /></div> : null}
    <div className="field">
      <label>Priority</label>
      <ClusterSelect value={projectPriority} onChange={(value) => setProjectPriority(value as Priority)} ariaLabel="Project priority" options={priorityOptions} />
    </div>
    <div className="field"><label>Start date</label><ClusterTextInput type="date" value={projectStartDate} onChange={(event) => setProjectStartDate(event.target.value)} /></div>
    <div className="field"><label>Target date</label><ClusterTextInput type="date" value={projectTargetDate} onChange={(event) => setProjectTargetDate(event.target.value)} /></div>
    <div className="field full"><label>Objective</label><ClusterTextArea value={projectObjective} onChange={(event) => setProjectObjective(event.target.value)} placeholder="Define success, delivery outcome, and the decision this project exists to support." /></div>
    <div className="field"><label>Client / stakeholder</label><ClusterTextInput value={projectClientName} onChange={(event) => setProjectClientName(event.target.value)} placeholder="Internal, client, publisher…" /></div>
    <div className="field"><label>Tags</label><ClusterTextInput value={projectTags} onChange={(event) => setProjectTags(event.target.value)} placeholder="launch, gameplay, partner" /></div>
    <ColorField value={projectColor} onChange={setProjectColor} label="Project color" />
    <div className="create-type-preview-v161 full">
      <strong>{selectedProjectType.label}</strong>
      <span>{selectedProjectType.note}</span>
      <em>{selectedProjectType.tracks.join(" · ")}</em>
      {(selectedProjectType.defaultTools || []).length ? <small>Tools: {(selectedProjectType.defaultTools || []).slice(0, 8).join(" · ")}</small> : null}
      {(selectedProjectType.dashboardWidgets || []).length ? <small>Dashboard: {(selectedProjectType.dashboardWidgets || []).slice(0, 6).join(" · ")}</small> : null}
    </div>
    <label className="tool-check"><ClusterInput type="checkbox" checked={createStarterBoard} onChange={(event) => setCreateStarterBoard(event.target.checked)} /> Starter board</label>
    <label className="tool-check"><ClusterInput type="checkbox" checked={createStarterWhiteboard} onChange={(event) => setCreateStarterWhiteboard(event.target.checked)} /> Starter whiteboard</label>
    <label className="tool-check create-library-toggle-v311"><ClusterInput type="checkbox" checked={createStarterLibrary} onChange={(event) => setCreateStarterLibrary(event.target.checked)} /><span><strong>Linked project Library</strong><small>Create the project folder automatically. If Library storage needs repair, the project still finishes creating.</small></span></label>
    <label className="tool-check"><ClusterInput type="checkbox" checked={projectExternal} onChange={(event) => setProjectExternal(event.target.checked)} /> External / partner-facing</label>
    {projectExternal && (
      <div className="field full">
        <label>{settings?.studioExternalOwnerFieldLabel || "External project owner"}</label>
        <ClusterSelect value={externalOwnerId} onChange={setExternalOwnerId} ariaLabel="External project owner" options={[{ value: "", label: "Select accountable owner" }, ...createUsers.map((user) => ({ value: user.id, label: displayUserName(user) }))]} />
        <small>Internal projects stay studio-owned. External projects require a named owner for partner/client accountability.</small>
      </div>
    )}
  </>;
}
