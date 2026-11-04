/** Pure keyboard and display helpers for settings controls. No domain mutation authority here. */
export type SettingsChoiceNavigation = { disabled?: boolean };

export function nextSettingsChoiceIndex(
  choices: readonly SettingsChoiceNavigation[],
  currentIndex: number,
  key: string,
): number {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return -1;
  const enabled = choices.flatMap((choice, index) => choice.disabled ? [] : [index]);
  if (!enabled.length) return -1;
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled[enabled.length - 1];
  const position = enabled.indexOf(currentIndex);
  const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  if (position < 0) return direction < 0 ? enabled[enabled.length - 1] : enabled[0];
  return enabled[(position + direction + enabled.length) % enabled.length];
}

export type SettingsReviewValue = string | number | boolean | null | undefined;

/** Display-only. Protected Server Config should pass metadata, not raw secrets. */
export function displaySettingsReviewValue(value: SettingsReviewValue, sensitive = false): string {
  if (sensitive) return "Protected value";
  if (value === undefined) return "Not provided";
  if (value === null) return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  const text = String(value).trim();
  return text.length ? text.slice(0, 140) : "Empty";
}
