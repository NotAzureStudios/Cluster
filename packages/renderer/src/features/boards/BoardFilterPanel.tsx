import { ClusterButton } from "../../components/ClusterButton";
import { ClusterCombobox } from "../../components/ClusterCombobox";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ClusterSelect } from "../../components/ClusterSelect";
import type { Priority, UserActivitySummary } from "../application/application-models";
import type { BoardIssueFilter } from "./board-workspace-model";
import { ClusterInput } from "../../components/ClusterNativeControls";

export function BoardFilterPanel({
  filteredCount,
  cardCount,
  priorityFilter,
  labelFilter,
  categoryFilter,
  assigneeFilter,
  issueFilter,
  density,
  hideDone,
  labels,
  categories,
  users,
  onPriorityFilter,
  onLabelFilter,
  onCategoryFilter,
  onAssigneeFilter,
  onIssueFilter,
  onDensity,
  onHideDone,
  onReset,
}: {
  filteredCount: number;
  cardCount: number;
  priorityFilter: "all" | Priority;
  labelFilter: string;
  categoryFilter: string;
  assigneeFilter: string;
  issueFilter: BoardIssueFilter;
  density: "compact" | "comfortable";
  hideDone: boolean;
  labels: string[];
  categories: string[];
  users: UserActivitySummary[];
  onPriorityFilter: (value: "all" | Priority) => void;
  onLabelFilter: (value: string) => void;
  onCategoryFilter: (value: string) => void;
  onAssigneeFilter: (value: string) => void;
  onIssueFilter: (value: BoardIssueFilter) => void;
  onDensity: (value: "compact" | "comfortable") => void;
  onHideDone: (value: boolean) => void;
  onReset: () => void;
}) {
  return (
    <ClusterDisclosureGroup title="Board filters" badge={`${filteredCount}/${cardCount} shown`} defaultOpen className="board-control-panel panel filter-drawer filter-menu-v0102">
      <div className="filter-menu-content-v0102 board-filter-grid-v0102">
        <div className="field control-mini"><label>Priority</label><ClusterSelect ariaLabel="Priority filter" value={priorityFilter} onChange={(value) => onPriorityFilter(value as "all" | Priority)} options={[
          { value: "all", label: "All" }, { value: "urgent", label: "Urgent" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" },
        ]} /></div>
        <div className="field control-mini"><label>Tag</label><ClusterCombobox ariaLabel="Tag filter" value={labelFilter} onChange={onLabelFilter} allowClear placeholder="All tags" searchPlaceholder="Search tags" options={labels.map((label) => ({ value: label, label }))} /></div>
        <div className="field control-mini"><label>Category</label><ClusterCombobox ariaLabel="Category filter" value={categoryFilter} onChange={onCategoryFilter} allowClear placeholder="All categories" searchPlaceholder="Search categories" options={categories.map((category) => ({ value: category, label: category }))} /></div>
        <div className="field control-mini"><label>Assigned to</label><ClusterCombobox ariaLabel="Assignee filter" value={assigneeFilter} onChange={onAssigneeFilter} allowClear placeholder="Anyone" searchPlaceholder="Search people" options={users.map((member) => ({ value: member.id, label: member.displayName || member.username }))} /></div>
        <div className="field control-mini"><label>Source Control</label><ClusterSelect ariaLabel="Source Control issue filter" value={issueFilter} onChange={(value) => onIssueFilter(value as BoardIssueFilter)} options={[
          { value: "all", label: "All" }, { value: "linked", label: "Linked" }, { value: "unlinked", label: "Unlinked" }, { value: "open", label: "Open" }, { value: "closed", label: "Closed" },
        ]} /></div>
        <div className="field control-mini"><label>Density</label><ClusterSegmentedControl value={density} onChange={onDensity} label="Board card density" options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Full" }]} /></div>
        <label className="tool-check board-check"><ClusterInput type="checkbox" checked={hideDone} onChange={(event) => onHideDone(event.target.checked)} /> Hide Done</label>
        <ClusterButton variant="secondary" onClick={onReset}>Clear</ClusterButton>
      </div>
    </ClusterDisclosureGroup>
  );
}
