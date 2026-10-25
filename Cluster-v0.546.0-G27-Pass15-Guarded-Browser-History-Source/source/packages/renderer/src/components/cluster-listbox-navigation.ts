/** Shared listbox movement. Keep identity by value so live search and async
 * option refreshes cannot silently move selection onto a disabled row. */
export type ClusterNavigableOption = { value: string; disabled?: boolean };

export function enabledClusterOptionIndexes(options: readonly ClusterNavigableOption[]): number[] {
  return options.flatMap((option, index) => option.disabled ? [] : [index]);
}

export function resolveClusterActiveValue(
  options: readonly ClusterNavigableOption[],
  activeValue: string | null,
  preferredValue?: string,
): string | null {
  if (activeValue !== null && options.some((option) => option.value === activeValue && !option.disabled)) return activeValue;
  const preferred = options.find((option) => option.value === preferredValue && !option.disabled);
  return preferred?.value ?? options.find((option) => !option.disabled)?.value ?? null;
}

export function moveClusterActiveValue(
  options: readonly ClusterNavigableOption[],
  activeValue: string | null,
  direction: 1 | -1,
): string | null {
  const enabled = enabledClusterOptionIndexes(options);
  if (!enabled.length) return null;
  const position = enabled.findIndex((index) => options[index].value === activeValue);
  if (position < 0) return options[enabled[direction === 1 ? 0 : enabled.length - 1]].value;
  return options[enabled[(position + direction + enabled.length) % enabled.length]].value;
}

export function edgeClusterActiveValue(options: readonly ClusterNavigableOption[], edge: "first" | "last"): string | null {
  const enabled = enabledClusterOptionIndexes(options);
  return enabled.length ? options[enabled[edge === "first" ? 0 : enabled.length - 1]].value : null;
}
