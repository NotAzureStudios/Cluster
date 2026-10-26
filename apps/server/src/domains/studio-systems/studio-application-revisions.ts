/** Revision-bound writes for application review and conversion.
 * A user must act on the application revision they actually inspected.
 */
export function applicationReviewWhere(id: string, expectedUpdatedAt: string) {
  return {
    id,
    updatedAt: new Date(expectedUpdatedAt),
    convertedUserId: null,
    status: { in: ["submitted", "under_review", "approved", "rejected"] },
  };
}

export function applicationConversionWhere(id: string, expectedUpdatedAt: string) {
  return {
    id,
    updatedAt: new Date(expectedUpdatedAt),
    convertedUserId: null,
    status: "approved",
  };
}
