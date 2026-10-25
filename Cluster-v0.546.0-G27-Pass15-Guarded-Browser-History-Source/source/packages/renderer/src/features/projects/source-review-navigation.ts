import type { ClusterWorkNavigationTarget } from "../workflow/work-navigation-types";

/** One canonical address for a requested source review, regardless of the entry surface. */
export function sourceReviewWorkTarget(projectId: string, reviewId: string): ClusterWorkNavigationTarget {
  return { screen: "project", projectId, projectTab: "source", inspectScope: "source-review", inspectId: reviewId };
}

/** A comment is not a review decision; the requested action remains outstanding. */
export function sourceReviewNeedsAction(myDecision: string | null | undefined): boolean {
  return myDecision !== "approved" && myDecision !== "changes_requested";
}

/** Only the canonical source-review inspector scope may select a review. */
export function readFocusedSourceReview(search: string): string | null {
  const inspect = new URLSearchParams(search).get("inspect") || "";
  return inspect.startsWith("source-review:") && inspect.length > "source-review:".length
    ? inspect.slice("source-review:".length) : null;
}

/** An exact ID only; opening a commit requires a Project-scoped API lookup. */
export function readFocusedSourceCommit(search: string): string | null {
  const inspect = new URLSearchParams(search).get("inspect") || "";
  return inspect.startsWith("source-commit:") && inspect.length > "source-commit:".length
    ? inspect.slice("source-commit:".length) : null;
}
