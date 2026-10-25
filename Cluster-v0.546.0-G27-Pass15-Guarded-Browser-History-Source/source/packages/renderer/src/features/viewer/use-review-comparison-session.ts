import type { ReviewComparisonMode, ReviewMedium } from "@cluster/shared";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ReviewComparisonSession } from "./review-comparison-session";

export function useReviewComparisonSession({
  medium,
  userId,
  identity,
  enabled,
  initialMode,
  initialAmount,
}: {
  medium: ReviewMedium;
  userId?: string | null;
  identity: string;
  enabled: boolean;
  initialMode?: ReviewComparisonMode;
  initialAmount?: number;
}) {
  const session = useMemo(() => new ReviewComparisonSession(medium, userId, enabled), [medium, userId, identity]);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => session.setEnabled(enabled), [session, enabled]);
  useEffect(() => { if (initialMode) session.setMode(initialMode); }, [session, initialMode]);
  useEffect(() => { if (initialAmount != null && Number.isFinite(initialAmount)) session.setAmount(initialAmount); }, [session, initialAmount]);
  return { comparisonSession: session, comparison: snapshot };
}
