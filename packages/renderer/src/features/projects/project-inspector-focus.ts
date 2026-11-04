/** Return focus to the underlying, currently visible Project card when a
 * floating context menu opened the inspector. IDs are compared as values, not
 * interpolated into CSS selectors. A missing/virtualized card is not guessed. */
export function projectInspectorReturnFocus(
  projectId: string,
  trigger: HTMLElement,
  root: Pick<Document, "querySelectorAll">,
): HTMLElement {
  for (const card of root.querySelectorAll<HTMLElement>("[data-project-id]")) {
    if (card.dataset.projectId !== projectId) continue;
    const selection = card.querySelector<HTMLElement>(".project-row-select-v370");
    if (selection) return selection;
  }
  return trigger;
}
