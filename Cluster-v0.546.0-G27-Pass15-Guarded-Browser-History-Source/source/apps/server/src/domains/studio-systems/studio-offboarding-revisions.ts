/** Bind a consequential offboarding decision to the case revision the admin actually reviewed. */
export function requireReviewedOffboardingRevision(
  current: { revision: number }, expectedRevision: number,
): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || current.revision !== expectedRevision) {
    throw Object.assign(new Error("This offboarding case changed since you reviewed it. Refresh before proceeding."), {
      code: "OFFBOARDING_CASE_STALE", statusCode: 409,
    });
  }
}
