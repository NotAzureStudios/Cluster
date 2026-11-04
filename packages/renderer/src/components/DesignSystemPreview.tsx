import { useMemo, useState } from "react";
import { ClusterActionButton } from "./ClusterActionButton";
import { ClusterButton } from "./ClusterButton";
import type { ClusterDataFilterGroup, ClusterDataSort } from "@cluster/shared";
import { ClusterDataTable } from "./ClusterDataTable";
import { ClusterCombobox } from "./ClusterCombobox";
import { ClusterEditablePropertyRow } from "./ClusterEditablePropertyRow";
import { ClusterEntityPicker } from "./ClusterEntityPicker";
import { ClusterProgressTracker } from "./ClusterProgressTracker";
import { ClusterSplitButton } from "./ClusterSplitButton";
import { ClusterField } from "./ClusterField";
import { ClusterMultiSelect } from "./ClusterMultiSelect";
import { ClusterSegmentedControl } from "./ClusterSegmentedControl";
import { ClusterStatus } from "./ClusterStatus";
import { ClusterCountBadge, ClusterHealthIndicator, ClusterTag } from "./ClusterStatusPrimitives";
import { ClusterDateRangeField, ClusterRecurrenceBuilder, type ClusterRecurrenceValue } from "./ClusterDateTimeControls";
import { ClusterDisclosureGroup } from "./ClusterDisclosureGroup";
import { ClusterPreviewCard } from "./ClusterPreviewCard";
import { ClusterFilterBuilder } from "./ClusterFilterBuilder";
import { ClusterTextInput } from "./ClusterTextInput";
import { ClusterTreeTable } from "./ClusterTreeTable";
import { ClusterSlider } from "./ClusterSlider";
import { ClusterToggle } from "./ClusterToggle";
import { ClusterSettingsChoiceGroup, ClusterSettingsChangeReview, ClusterSettingsRow, ClusterSettingsSection } from "./ClusterSettingsPrimitives";

const PREVIEW_ROWS = [
  { id: "build", name: "Build", state: "Ready" },
  { id: "qa", name: "QA", state: "Review" },
];

const PREVIEW_TREE = [
  { id: "assets", name: "Assets", type: "Folder", children: [{ id: "characters", name: "Characters", type: "Folder", children: [{ id: "hero", name: "Hero.fbx", type: "Model", children: [] }] }] },
  { id: "audio", name: "Audio", type: "Folder", children: [] },
];

export function DesignSystemPreview() {
  const [mode, setMode] = useState<"standard" | "dense">("standard");
  const [selection, setSelection] = useState<string[]>(["build"]);
  const [sorts, setSorts] = useState<ClusterDataSort[]>([]);
  const [rowsSelected, setRowsSelected] = useState<Set<string>>(new Set());
  const [system, setSystem] = useState("build");
  const [owner, setOwner] = useState("duckey");
  const [sliderValue, setSliderValue] = useState(58);
  const [toggleValue, setToggleValue] = useState(true);
  const [settingsDensity, setSettingsDensity] = useState<"compact" | "comfortable">("compact");
  const [settingsSound, setSettingsSound] = useState(true);
  const [propertyDraft, setPropertyDraft] = useState("Ready for review");
  const [dateRange, setDateRange] = useState({ start: "2026-09-15", end: "2026-09-30" });
  const [recurrence, setRecurrence] = useState<ClusterRecurrenceValue>({ frequency: "weekly", interval: 1, weekdays: ["1", "3", "5"] });
  const [filters, setFilters] = useState<ClusterDataFilterGroup>({ logic: "and", conditions: [{ id: "preview-status", fieldId: "status", operator: "equals", value: "ready" }] });
  const [expandedTreeKeys, setExpandedTreeKeys] = useState<Set<string>>(new Set(["assets", "characters"]));
  const columns = useMemo(() => [
    { id: "name", header: "Surface", cell: (row: typeof PREVIEW_ROWS[number]) => row.name, sortValue: (row: typeof PREVIEW_ROWS[number]) => row.name, defaultWidth: 180 },
    { id: "state", header: "State", cell: (row: typeof PREVIEW_ROWS[number]) => row.state, sortValue: (row: typeof PREVIEW_ROWS[number]) => row.state, defaultWidth: 140 },
  ], []);

  return (
    <section className="design-system-preview-v383" aria-label="Cluster design system component preview">
      <header>
        <div>
          <p className="eyebrow">Design system</p>
          <h3>Component preview</h3>
        </div>
        <span className="design-system-token-badge-v383">Semantic tokens</span>
      </header>
      <div className="design-system-preview-grid-v383">
        <div className="design-system-preview-group-v383">
          <span>Actions & feedback</span>
          <div className="button-row">
            <ClusterButton variant="primary">Primary</ClusterButton>
            <ClusterButton selected>Selected</ClusterButton>
            <ClusterActionButton action={() => Promise.resolve()} workingLabel="Saving…" successLabel="Saved">Save</ClusterActionButton>
            <ClusterButton variant="danger">Danger</ClusterButton>
          </div>
        </div>
        <ClusterField label="Field" htmlFor="design-system-preview-field" state="success" className="design-system-preview-group-v383">
          <ClusterTextInput id="design-system-preview-field" value="Cluster interface" readOnly />
        </ClusterField>
        <div className="design-system-preview-group-v383">
          <span>Operational states</span>
          <div className="design-system-state-row-v383">
            <ClusterStatus state="success" dot>Ready</ClusterStatus>
            <ClusterStatus state="warning" dot>Warning</ClusterStatus>
            <ClusterStatus state="error" dot>Error</ClusterStatus>
            <ClusterStatus state="offline" dot>Offline</ClusterStatus>
            <ClusterStatus state="stale" dot>Stale</ClusterStatus>
            <ClusterStatus state="conflict" dot>Conflict</ClusterStatus>
          </div>
        </div>
        <div className="design-system-preview-group-v383">
          <span>Structured controls</span>
          <ClusterSegmentedControl value={mode} onChange={setMode} label="Preview density" options={[{ value: "standard", label: "Standard" }, { value: "dense", label: "Dense" }]} />
          <ClusterMultiSelect values={selection} onChange={setSelection} ariaLabel="Preview systems" options={[{ value: "build", label: "Builds" }, { value: "qa", label: "QA" }, { value: "source", label: "Source Control" }]} />
          <ClusterCombobox value={system} onChange={setSystem} ariaLabel="Preview searchable system" options={[{ value: "build", label: "Builds", meta: "Delivery" }, { value: "qa", label: "QA", meta: "Verification" }, { value: "source", label: "Source Control", meta: "Engineering" }]} />
          <ClusterEntityPicker value={owner} onChange={setOwner} ariaLabel="Preview owner" entities={[{ id: "duckey", label: "Duckey", meta: "Project lead", kind: "person", icon: "user" }, { id: "qa", label: "QA Team", meta: "Department", kind: "team", icon: "users" }]} />
          <label className="cluster-slider-field-v533"><span>Slider primitive</span><output className="cluster-slider-value-v533">{sliderValue}%</output><ClusterSlider min="0" max="100" value={sliderValue} onChange={(event) => setSliderValue(Number(event.target.value))} aria-label="Preview slider" /></label><ClusterToggle checked={toggleValue} onCheckedChange={setToggleValue} label="Toggle primitive" description="Persistent on/off settings" />
        </div>
        <div className="design-system-preview-group-v383">
          <span>Settings interactions · v1.1</span>
          <ClusterSettingsSection title="Live settings examples" summary="Controls are local to this preview.">
            <ClusterSettingsRow label="Sound feedback" description="A concise on/off preference">
              <ClusterToggle checked={settingsSound} onCheckedChange={setSettingsSound} aria-label="Preview sound feedback" />
            </ClusterSettingsRow>
            <ClusterSettingsRow label="Density" help="Different workspaces can reuse the same selection behavior.">
              <ClusterSettingsChoiceGroup label="Preview settings density" density="compact" value={settingsDensity} onChange={setSettingsDensity}
                options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }]} />
            </ClusterSettingsRow>
            <ClusterSettingsChangeReview label="Example change review" changes={[
              { id: "density", label: "Interface density", before: "Compact", after: settingsDensity, impact: "none" },
              { id: "security", label: "Protected setting", sensitive: true, before: "secret", after: "updated-secret", impact: "protected" },
            ]} />
          </ClusterSettingsSection>
        </div>
        <div className="design-system-preview-group-v383">
          <span>Data table</span>
          <ClusterDataTable rows={PREVIEW_ROWS} columns={columns} rowKey={(row) => row.id} label="Preview work surfaces" selectedKeys={rowsSelected} onSelectionChange={setRowsSelected} sorts={sorts} onSortsChange={setSorts} configurableColumns persistKey="design-system-preview" />
        </div>
        <div className="design-system-preview-group-v383">
          <span>Property, progress & split actions</span>
          <ClusterEditablePropertyRow label="Release state" value={propertyDraft} editor={<ClusterTextInput value={propertyDraft} onChange={(event) => setPropertyDraft(event.target.value)} aria-label="Release state" />} onSave={() => Promise.resolve()} />
          <ClusterProgressTracker label="Delivery progress" steps={[{ id: "source", label: "Source", state: "complete" }, { id: "build", label: "Build", state: "current" }, { id: "qa", label: "QA", state: "pending" }]} />
          <ClusterSplitButton label="Create Build" onPrimary={() => undefined} actions={[{ id: "shipping", label: "Shipping Build", onSelect: () => undefined }, { id: "development", label: "Development Build", onSelect: () => undefined }]} />
        </div>
        <div className="design-system-preview-group-v383">
          <span>Dates, recurrence & disclosure</span>
          <ClusterDateRangeField start={dateRange.start} end={dateRange.end} onChange={setDateRange} label="Preview delivery window" />
          <ClusterRecurrenceBuilder value={recurrence} onChange={setRecurrence} label="Preview recurrence" />
          <ClusterDisclosureGroup title="Advanced behavior" summary="Progressive disclosure" badge="3 settings"><p className="muted">Dense configuration can stay available without occupying the default surface.</p></ClusterDisclosureGroup>
        </div>
        <div className="design-system-preview-group-v383">
          <span>Typed status & preview</span>
          <div className="design-system-state-row-v383"><ClusterHealthIndicator tone="good">Healthy</ClusterHealthIndicator><ClusterTag tone="info">Release</ClusterTag><ClusterCountBadge count={14} label="Open items" /></div>
          <ClusterPreviewCard label="Build preview" trigger={<ClusterStatus tone="info">Preview A.1.4.2</ClusterStatus>}><strong>A.1.4.2</strong><p className="muted">Source, build, QA, and release context can be previewed without leaving the current surface.</p></ClusterPreviewCard>
        </div>
        <div className="design-system-preview-group-v383">
          <span>Filter builder</span>
          <ClusterFilterBuilder fields={[{ id: "status", label: "Status", type: "enum", filterable: true, options: [{ value: "ready", label: "Ready" }, { value: "blocked", label: "Blocked" }] }, { id: "owner", label: "Owner", type: "text", filterable: true }, { id: "due", label: "Due date", type: "date", filterable: true }]} filters={filters} onChange={setFilters} label="Preview filters" />
        </div>
        <div className="design-system-preview-group-v383">
          <span>Tree table</span>
          <ClusterTreeTable roots={PREVIEW_TREE} childrenOf={(row) => row.children} rowKey={(row) => row.id} columns={[{ id: "name", header: "Name", cell: (row) => row.name }, { id: "type", header: "Type", cell: (row) => row.type }]} expandedKeys={expandedTreeKeys} onExpandedChange={setExpandedTreeKeys} label="Preview hierarchy" rowLabel={(row) => row.name} />
        </div>
      </div>
    </section>
  );
}
