/** Published Forms branching: only an earlier visible selection/boolean can reveal a dependent field. */
export type StudioFormVisibilityCondition = { fieldId: string; equals: string | boolean };
export type StudioFormVisibilityField = { id: string; type?: string; visibleWhen?: StudioFormVisibilityCondition | null };

/** Evaluate in published field order. Hidden ancestors cannot reveal descendants. */
export function visibleStudioFormFieldIds(fields: readonly StudioFormVisibilityField[], answers: Record<string, unknown>): Set<string> {
  const visible = new Set<string>();
  const sources = new Map(fields.map((field) => [field.id, field]));
  for (const field of fields) {
    const rule = field.visibleWhen;
    if (!rule) { visible.add(field.id); continue; }
    if (!visible.has(rule.fieldId)) continue;
    const raw = answers[rule.fieldId];
    // An unchecked checkbox has no entry in a new form, but is rendered false.
    const source = raw === undefined && ["checkbox", "acknowledgement"].includes(sources.get(rule.fieldId)?.type || "") ? false : raw;
    const matches = typeof rule.equals === "boolean"
      ? source === rule.equals
      : (typeof source === "string" && source === rule.equals) || (Array.isArray(source) && source.includes(rule.equals));
    if (matches) visible.add(field.id);
  }
  return visible;
}

/** Strip stale answers from collapsed branches before storing a final submission. */
export function projectVisibleStudioFormAnswers(fields: readonly StudioFormVisibilityField[], answers: Record<string, unknown>): Record<string, unknown> {
  const visible = visibleStudioFormFieldIds(fields, answers);
  return Object.fromEntries(Object.entries(answers).filter(([id]) => visible.has(id)));
}
