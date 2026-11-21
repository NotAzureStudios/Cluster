import type { ChangeEvent, ReactNode, RefObject } from "react";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { formatRelativeTime } from "../../core/format";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterActionMenu } from "../../components/ClusterContextActions";

export function WhiteboardZoomControls({ zoom, onZoomOut, onZoomIn, onReset }: { zoom: number; onZoomOut: () => void; onZoomIn: () => void; onReset: () => void }) {
  return <div className="zoom-pill">
    <ClusterButton size="compact" variant="quiet" onClick={onZoomOut} aria-label="Zoom out"><ClusterIcon name="minus" /></ClusterButton>
    <ClusterButton size="compact" variant="quiet" onClick={onReset} title="Reset to 100%">{Math.round(zoom * 100)}%</ClusterButton>
    <ClusterButton size="compact" variant="quiet" onClick={onZoomIn} aria-label="Zoom in"><ClusterIcon name="plus" /></ClusterButton>
  </div>;
}

export function WhiteboardMoreMenu({
  active,
  selectedCount,
  groupCount,
  presentationMode,
  facilitatorMode,
  frameCount,
  fullscreen,
  outline,
  navigator,
  compactToolbar,
  autoSave,
  showDetails,
  showSavedViews,
  onToggleDetails,
  onToggleSavedViews,
  onCreate,
  onDuplicateSelection,
  onDeleteSelection,
  onGroup,
  onUngroup,
  onTogglePresentation,
  onToggleFacilitator,
  onDuplicateWhiteboard,
  onToggleFullscreen,
  onToggleOutline,
  onToggleNavigator,
  onToggleCompactToolbar,
  onToggleAutoSave,
  onExportPng,
  onExportSvg,
  onExportJson,
  onClear,
  onDeleteWhiteboard,
}: {
  active: boolean; selectedCount: number; groupCount: number; presentationMode: boolean; facilitatorMode: boolean; frameCount: number; fullscreen: boolean; outline: boolean; navigator: boolean; compactToolbar: boolean; autoSave: boolean; showDetails: boolean; showSavedViews: boolean;
  onToggleDetails: () => void; onToggleSavedViews: () => void; onCreate: () => void; onDuplicateSelection: () => void; onDeleteSelection: () => void; onGroup: () => void; onUngroup: () => void; onTogglePresentation: () => void; onToggleFacilitator: () => void; onDuplicateWhiteboard: () => void; onToggleFullscreen: () => void; onToggleOutline: () => void; onToggleNavigator: () => void; onToggleCompactToolbar: () => void; onToggleAutoSave: () => void; onExportPng: () => void; onExportSvg: () => void; onExportJson: () => void; onClear: () => void; onDeleteWhiteboard: () => void;
}) {
  return <ClusterActionMenu
    label="Whiteboard actions"
    triggerLabel="More"
    items={[
      { id: "details", label: showDetails ? "Hide details" : "Whiteboard details", onSelect: onToggleDetails },
      { id: "saved-views", label: showSavedViews ? "Hide saved views" : "Saved views", disabled: !active, onSelect: onToggleSavedViews },
      { id: "new", label: "New whiteboard", onSelect: onCreate },
      { id: "duplicate-selection", label: "Duplicate selection", disabled: !selectedCount, separatorBefore: true, onSelect: onDuplicateSelection },
      { id: "delete-selection", label: "Delete selection", disabled: !selectedCount, onSelect: onDeleteSelection },
      { id: "group", label: "Group selection", disabled: selectedCount < 2, onSelect: onGroup },
      { id: "ungroup", label: "Ungroup selection", disabled: !groupCount, onSelect: onUngroup },
      { id: "presentation", label: presentationMode ? "Exit presentation" : "Present frames", disabled: !active || (!presentationMode && !frameCount), separatorBefore: true, onSelect: onTogglePresentation },
      { id: "facilitator", label: facilitatorMode ? "End facilitator session" : "Facilitator session", disabled: !active, onSelect: onToggleFacilitator },
      { id: "duplicate", label: "Duplicate whiteboard", disabled: !active, onSelect: onDuplicateWhiteboard },
      { id: "fullscreen", label: fullscreen ? "Exit fullscreen" : "Fullscreen", disabled: !active, onSelect: onToggleFullscreen },
      { id: "outline", label: outline ? "Hide outline" : "Show outline", disabled: !active, onSelect: onToggleOutline },
      { id: "navigator", label: navigator ? "Hide navigator" : "Show navigator", disabled: !active, onSelect: onToggleNavigator },
      { id: "toolbar", label: compactToolbar ? "Expanded tools" : "Compact tools", disabled: !active, onSelect: onToggleCompactToolbar },
      { id: "autosave", label: autoSave ? "Disable autosave" : "Enable autosave", disabled: !active, onSelect: onToggleAutoSave },
      { id: "export-png", label: "Export PNG", disabled: !active, separatorBefore: true, onSelect: onExportPng },
      { id: "export-svg", label: "Export SVG", disabled: !active, onSelect: onExportSvg },
      { id: "export-json", label: "Export JSON", disabled: !active, onSelect: onExportJson },
      { id: "clear", label: "Clear canvas", disabled: !active, danger: true, separatorBefore: true, onSelect: onClear },
      { id: "delete", label: "Delete whiteboard", disabled: !active, danger: true, onSelect: onDeleteWhiteboard },
    ]}
  />;
}

export function WhiteboardCommandBar({
  dirty,
  saving,
  lastSavedAt,
  autoSave,
  outline,
  categories,
  navigator,
  imageInputRef,
  onImageInput,
  onFit,
  onToggleOutline,
  onAddImage,
  onToggleCategories,
  onToggleNavigator,
  onAutoSave,
  tools,
}: {
  dirty: boolean; saving: boolean; lastSavedAt: string | null; autoSave: boolean; outline: boolean; categories: boolean; navigator: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onImageInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onFit: () => void; onToggleOutline: () => void; onAddImage: () => void; onToggleCategories: () => void; onToggleNavigator: () => void; onAutoSave: (enabled: boolean) => void;
  tools?: ReactNode;
}) {
  const state = saving ? "Saving…" : "Unsaved";
  return <div className="whiteboard-commandbar-v299">
    {tools}
    <div className="whiteboard-view-actions-v299">
      <ClusterButton size="compact" variant="quiet" onClick={onFit}>Fit</ClusterButton>
      <ClusterButton size="compact" variant="quiet" selected={outline} onClick={onToggleOutline}>Outline</ClusterButton>
      <ClusterButton size="compact" variant="quiet" selected={categories} onClick={onToggleCategories}>Layers</ClusterButton>
      <ClusterButton size="compact" variant="quiet" selected={navigator} onClick={onToggleNavigator}>Navigator</ClusterButton>
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onImageInput} />
      <ClusterIconButton size="compact" label="Add image" onClick={onAddImage}><ClusterIcon name="image" /></ClusterIconButton>
      <label className="whiteboard-autosave-toggle-v299"><ClusterInput type="checkbox" checked={autoSave} onChange={(event) => onAutoSave(event.target.checked)} /> Autosave</label>
      {(dirty || saving) && <span className="whiteboard-save-state-v299" title={lastSavedAt ? `Last saved ${formatRelativeTime(lastSavedAt)}` : autoSave ? "Autosave on" : "Manual save"}>
        <span className={`save-dot-v299 ${dirty ? "dirty" : "clean"}`} />{state}
      </span>}
    </div>
  </div>;
}
