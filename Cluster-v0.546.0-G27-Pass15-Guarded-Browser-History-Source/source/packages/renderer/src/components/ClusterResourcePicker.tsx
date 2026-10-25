import { useMemo } from "react";
import { CLUSTER_RESOURCE_MANIFEST, type ClusterResourceKind } from "@cluster/shared";
import { ClusterEntityPicker } from "./ClusterEntityPicker";

/** The caller supplies already-authorized resources; this component never grants access. */
export type ClusterResourcePickerOption = {
  kind: ClusterResourceKind;
  id: string;
  label: string;
  projectId?: string | null;
  disabled?: boolean;
};

export function scopedResourcePickerOptions(
  resources: readonly ClusterResourcePickerOption[],
  projectId?: string | null,
  allowedKinds?: readonly ClusterResourceKind[],
) {
  const unique = new Set<string>();
  return resources.filter((resource) => {
    if (!resource.id.trim() || !resource.label.trim()) return false;
    if (!CLUSTER_RESOURCE_MANIFEST[resource.kind]) return false;
    if (allowedKinds && !allowedKinds.includes(resource.kind)) return false;
    if (projectId && CLUSTER_RESOURCE_MANIFEST[resource.kind].projectScoped && resource.projectId !== projectId) return false;
    const key = `${resource.kind}:${resource.id}`;
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });
}

export function ClusterResourcePicker({
  resources, value, onChange, ariaLabel, projectId, allowedKinds, disabled = false, onSearchChange, emptyMessage,
}: {
  resources: readonly ClusterResourcePickerOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  projectId?: string | null;
  allowedKinds?: readonly ClusterResourceKind[];
  disabled?: boolean;
  onSearchChange?: (value: string) => void;
  emptyMessage?: string;
}) {
  const options = useMemo(() => scopedResourcePickerOptions(resources, projectId, allowedKinds), [resources, projectId, allowedKinds]);
  return <ClusterEntityPicker
    value={options.some((option) => `${option.kind}:${option.id}` === value) ? value : ""}
    onChange={onChange}
    ariaLabel={ariaLabel}
    placeholder="Select resource"
    searchPlaceholder="Find a resource"
    allowClear={false}
    disabled={disabled}
    onSearchChange={onSearchChange}
    emptyMessage={emptyMessage || "No authorized resources match"}
    entities={options.map((option) => ({
      id: `${option.kind}:${option.id}`,
      label: option.label,
      meta: CLUSTER_RESOURCE_MANIFEST[option.kind].label,
      kind: CLUSTER_RESOURCE_MANIFEST[option.kind].plural,
      disabled: option.disabled,
    }))}
  />;
}
