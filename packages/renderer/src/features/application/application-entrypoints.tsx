import { lazy, Suspense } from "react";
import { LazyFeatureBoundary } from "../../components/FeatureBoundary";
import { LoadingState, PolicyLoadingState } from "../../components/LoadingState";
import type { Project } from "./application-models";

const LazyChangelogPage = lazy(() => import("../changelog/ChangelogPage"));
const LazyPublicSharePage = lazy(() => import("../public-share/PublicSharePage"));
const LazyPrivacyPolicyPage = lazy(() => import("../legal/PrivacyPolicyPage"));
const LazyTermsPolicyPage = lazy(() => import("../legal/TermsPolicyPage"));
const LazyOperatorAgreementPage = lazy(() => import("../legal/OperatorAgreementPage"));
const LazyCopyrightPolicyPage = lazy(() => import("../legal/CopyrightPolicyPage"));
const LazySecurityDisclosurePolicyPage = lazy(() => import("../legal/SecurityDisclosurePolicyPage"));
const LazyThirdPartyDisclosurePage = lazy(() => import("../legal/ThirdPartyDisclosurePage"));
const LazyCopyrightReportPage = lazy(() => import("../legal/CopyrightReportPage"));
const LazyCopyrightCounterNoticePage = lazy(() => import("../legal/CopyrightCounterNoticePage"));
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

export function PrivacyPolicyPage() {
  return (
    <Suspense fallback={<PolicyLoadingState label="Loading privacy policy" />}>
      <LazyPrivacyPolicyPage />
    </Suspense>
  );
}


export function TermsPolicyPage() {
  return (
    <Suspense fallback={<PolicyLoadingState label="Loading Terms of Service" />}>
      <LazyTermsPolicyPage />
    </Suspense>
  );
}

export function OperatorAgreementPage() {
  return (
    <Suspense fallback={<PolicyLoadingState label="Loading Server Operator Agreement" />}>
      <LazyOperatorAgreementPage />
    </Suspense>
  );
}

export function CopyrightPolicyPage() {
  return (
    <Suspense fallback={<PolicyLoadingState label="Loading Copyright policy" />}>
      <LazyCopyrightPolicyPage />
    </Suspense>
  );
}

export function SecurityDisclosurePolicyPage() {
  return (
    <Suspense fallback={<PolicyLoadingState label="Loading security disclosure policy" />}>
      <LazySecurityDisclosurePolicyPage />
    </Suspense>
  );
}


export function ThirdPartyDisclosurePage() {
  return (
    <Suspense fallback={<PolicyLoadingState label="Loading third-party disclosure" />}>
      <LazyThirdPartyDisclosurePage />
    </Suspense>
  );
}

export function CopyrightReportPage() {
  return (
    <Suspense fallback={<PolicyLoadingState label="Loading copyright reporting" />}>
      <LazyCopyrightReportPage />
    </Suspense>
  );
}

export function CopyrightCounterNoticePage() {
  return (
    <Suspense fallback={<PolicyLoadingState label="Loading counter-notice workflow" />}>
      <LazyCopyrightCounterNoticePage />
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
