import type { ReactNode } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterCombobox } from "./ClusterCombobox";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";

export type ClusterEntityOption = {
  id: string;
  label: string;
  meta?: string;
  disabled?: boolean;
  kind?: string;
  icon?: ClusterIconName;
};

export function ClusterEntityToken({ entity, onRemove, disabled = false }: { entity: ClusterEntityOption; onRemove?: () => void; disabled?: boolean }) {
  return (
    <span className="cluster-action-group-v425" data-cluster-entity-kind={entity.kind || "entity"}>
      {entity.icon ? <ClusterIcon name={entity.icon} aria-hidden="true" /> : null}
      <span>{entity.label}</span>
      {entity.meta ? <em>{entity.meta}</em> : null}
      {onRemove ? <ClusterButton variant="quiet" size="compact" disabled={disabled} onClick={onRemove} aria-label={`Remove ${entity.label}`}><ClusterIcon name="close" /></ClusterButton> : null}
    </span>
  );
}

export function ClusterEntityPicker({
  value,
  entities,
  onChange,
  ariaLabel,
  placeholder = "Select entity",
  searchPlaceholder = "Search entities",
  allowClear = true,
  disabled = false,
  emptyMessage = "No matching entities",
  selectionPrefix,
  onSearchChange,
}: {
  value: string;
  entities: readonly ClusterEntityOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  searchPlaceholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
  selectionPrefix?: ReactNode;
  onSearchChange?: (value: string) => void;
}) {
  return (
    <ClusterCombobox
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      disabled={disabled}
      allowClear={allowClear}
      onSearchChange={onSearchChange}
      options={entities.map((entity) => ({ value: entity.id, label: entity.label, meta: entity.meta, disabled: entity.disabled, group: entity.kind }))}
      renderSelection={(option) => option ? <>{selectionPrefix}{option.label}</> : placeholder}
    />
  );
}
