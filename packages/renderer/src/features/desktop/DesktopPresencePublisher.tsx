import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../core/api";
import type { AppNavigationState } from "../../core/navigation";
import type { Project } from "../application/application-models";
import { CLUSTER_WORK_PROJECT_QUERY_KEY } from "../workflow/work-navigation";

const PRESENCE_POLICY_CHANGED_EVENT = "cluster:presence-policy-changed";
const PRESENCE_CONTEXT_TTL_MS = 10 * 60 * 1000;
const PRESENCE_HEARTBEAT_MS = 4 * 60 * 1000;
const SUPPORTED_INSPECTOR_KINDS = new Map<string, "repository" | "ticket" | "library" | "build">([
  ["repo", "repository"],
  ["repository", "repository"],
  ["ticket", "ticket"],
  ["library", "library"],
  ["build", "build"],
]);

type PresenceDisclosure = "connection" | "work_state" | "application" | "project" | "detailed";
type PresencePolicyResponse = {
  presence?: {
    connectionVisibility?: "visible" | "invisible" | string;
    presenceDisclosure?: PresenceDisclosure | string;
  };
};

type PresenceContextPayload = {
  applicationKey: "cluster";
  projectId?: string;
  repositoryId?: string;
  resourceKind?: "project" | "repository" | "board" | "whiteboard" | "ticket" | "library" | "build";
  resourceId?: string;
  sensitivity: "normal";
  expiresAt: string;
};

function currentInspector() {
  if (typeof window === "undefined") return null;
  const value = new URL(window.location.href).searchParams.get("inspect");
  if (!value || !value.includes(":")) return null;
  const separator = value.indexOf(":");
  const scope = value.slice(0, separator).trim();
  const id = value.slice(separator + 1).trim();
  if (!scope || !id || id.length > 240) return null;
  return { scope, id };
}

function currentWorkProjectId(navigation: AppNavigationState) {
  if (navigation.context.projectId) return navigation.context.projectId;
  if (typeof window === "undefined") return null;
  const value = new URL(window.location.href).searchParams.get(CLUSTER_WORK_PROJECT_QUERY_KEY)?.trim();
  return value && value.length <= 200 ? value : null;
}

function buildDeclaredContext(navigation: AppNavigationState, projects: Project[], disclosure: PresenceDisclosure): PresenceContextPayload {
  const expiresAt = new Date(Date.now() + PRESENCE_CONTEXT_TTL_MS).toISOString();
  const payload: PresenceContextPayload = { applicationKey: "cluster", sensitivity: "normal", expiresAt };
  if (disclosure === "application") return payload;

  const projectId = currentWorkProjectId(navigation);
  if (!projectId) return payload;
  payload.projectId = projectId;
  if (disclosure !== "detailed") return payload;

  const project = projects.find((candidate) => candidate.id === projectId) || null;
  const primarySource = project?.sourceBindings?.find((binding) => binding.isPrimary) || project?.sourceBindings?.[0] || null;
  if (primarySource?.repositoryId) payload.repositoryId = primarySource.repositoryId;

  if (navigation.context.boardId) {
    payload.resourceKind = "board";
    payload.resourceId = navigation.context.boardId;
    return payload;
  }
  if (navigation.context.whiteboardId) {
    payload.resourceKind = "whiteboard";
    payload.resourceId = navigation.context.whiteboardId;
    return payload;
  }
  const inspector = currentInspector();
  const inspectorKind = inspector ? SUPPORTED_INSPECTOR_KINDS.get(inspector.scope) : null;
  if (inspector && inspectorKind) {
    payload.resourceKind = inspectorKind;
    payload.resourceId = inspector.id;
    return payload;
  }
  payload.resourceKind = "project";
  payload.resourceId = projectId;
  return payload;
}

export function DesktopPresencePublisher({ enabled, navigation, projects }: { enabled: boolean; navigation: AppNavigationState; projects: Project[] }) {
  const [locationRevision, setLocationRevision] = useState(0);
  const lastPublishedRef = useRef<string>("");
  const navigationIdentity = useMemo(() => JSON.stringify(navigation), [navigation]);

  useEffect(() => {
    if (!enabled) return;
    const changed = () => setLocationRevision((value) => value + 1);
    window.addEventListener("popstate", changed);
    window.addEventListener("hashchange", changed);
    window.addEventListener("cluster:inspector-state-changed", changed as EventListener);
    window.addEventListener(PRESENCE_POLICY_CHANGED_EVENT, changed as EventListener);
    return () => {
      window.removeEventListener("popstate", changed);
      window.removeEventListener("hashchange", changed);
      window.removeEventListener("cluster:inspector-state-changed", changed as EventListener);
      window.removeEventListener(PRESENCE_POLICY_CHANGED_EVENT, changed as EventListener);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer = 0;

    const clearPublishedContext = async () => {
      lastPublishedRef.current = "";
      await api("/api/me/presence/context", { method: "DELETE", skipCacheInvalidation: true }).catch(() => undefined);
    };

    const publish = async () => {
      try {
        const current = await api<PresencePolicyResponse>("/api/me/presence", { skipCacheInvalidation: true });
        if (cancelled) return;
        const disclosure = String(current.presence?.presenceDisclosure || "work_state") as PresenceDisclosure;
        const invisible = current.presence?.connectionVisibility === "invisible";
        if (invisible || disclosure === "connection" || disclosure === "work_state") {
          await clearPublishedContext();
          return;
        }
        if (!(["application", "project", "detailed"] as const).includes(disclosure as any)) {
          await clearPublishedContext();
          return;
        }
        const payload = buildDeclaredContext(navigation, projects, disclosure);
        const fingerprint = JSON.stringify({ ...payload, expiresAt: undefined });
        // The heartbeat deliberately republishes unchanged context so server expiry remains bounded after crashes.
        await api("/api/me/presence/context", { method: "PUT", body: JSON.stringify(payload), skipCacheInvalidation: true });
        if (!cancelled) lastPublishedRef.current = fingerprint;
      } catch {
        // Presence is advisory. Authentication/session errors are handled centrally by the API transport.
      }
    };

    void publish();
    timer = window.setInterval(() => { void publish(); }, PRESENCE_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, navigationIdentity, projects, locationRevision]);

  return null;
}

export function announceDesktopPresencePolicyChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PRESENCE_POLICY_CHANGED_EVENT));
}
