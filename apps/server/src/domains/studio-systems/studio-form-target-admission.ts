/**
 * Private submission deep links may resolve for an active, explicitly scoped
 * reviewer. Never return a Form identifier until that Form's current grant has
 * been checked; absent, application and denied submissions are indistinguishable.
 */
export async function resolveAuthorizedStudioFormTarget(input: {
  submissionId: string;
  lookup: (submissionId: string) => Promise<{ formId?: string | null; form?: { purpose?: string | null } | null } | null>;
  mayReview: (formId: string) => Promise<boolean>;
}): Promise<{ formId: string } | null> {
  if (typeof input.submissionId !== "string" || !input.submissionId.trim() || input.submissionId.length > 160) return null;
  const submission = await input.lookup(input.submissionId);
  const formId = submission?.formId;
  if (!formId || !submission?.form || submission.form.purpose === "application") return null;
  if (!(await input.mayReview(formId))) return null;
  return { formId };
}
