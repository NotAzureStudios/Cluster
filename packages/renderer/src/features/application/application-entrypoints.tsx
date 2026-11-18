import { lazy, Suspense } from "react";
import { LazyFeatureBoundary } from "../../components/FeatureBoundary";
import { LoadingState, PolicyLoadingState } from "../../components/LoadingState";
import type { Project } from "./application-models";

const LazyChangelogPage = lazy(() => import("../changelog/ChangelogPage"));
const LazyPublicSharePage = lazy(() => import("../public-share/PublicSharePage"));
const LazyCalendarPage = lazy(() => import("../calendar/CalendarPage"));

export const LazyTimeWorkspacePage = lazy(() => import("../time/TimeWorkspacePage"));
export const LazyLibraryWorkspacePage = lazy(() => import("../library/LibraryWorkspacePage"));
export const LazyPacketsPage = lazy(() => import("../packets/PacketsPage"));

export function ChangelogPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading release history" rows={6} compact />}>
      <LazyChangelogPage />
    </Suspense>
  );
}

export function PublicSharePage({ token }: { token: string }) {
  return (
    <Suspense fallback={<div className="public-share-shell-v197"><div className="public-share-card-v197"><strong>Cluster</strong><span>Opening restricted project view...</span></div></div>}>
      <LazyPublicSharePage token={token} />
    </Suspense>
  );
}











export function CalendarPage({ projects }: { projects: Project[] }) {
  return (
    <LazyFeatureBoundary label="Calendar">
      <LazyCalendarPage projects={projects} />
    </LazyFeatureBoundary>
  );
}
