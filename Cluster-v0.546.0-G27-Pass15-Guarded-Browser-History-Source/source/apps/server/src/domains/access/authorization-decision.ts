import type { ClusterToolPermissionKey } from "@cluster/shared";

export type AuthorizationAction = "view" | "contribute" | "manage" | "admin" | "subscribe" | "disclose-private";

export type AuthorizationActor = {
  user: any | null;
  decorated?: any | null;
  role?: string | null;
};

export type AuthorizationResource =
  | { kind: "workspace"; id?: string | null }
  | { kind: "tool"; tool: ClusterToolPermissionKey | string }
  | { kind: "project"; project: any }
  | { kind: "target"; targetKind: string; targetId: string; project?: any | null }
  | { kind: "user"; ownerUserId?: string | null; tool: ClusterToolPermissionKey | string; allowUnowned?: boolean };

export type DisclosureSurface = "api" | "search" | "export" | "analytics" | "realtime" | "desktop-cache";

export type DisclosureObligation = {
  kind: "field-redaction" | "visibility";
  profile: string;
  surface: DisclosureSurface;
  omitFields?: string[];
  reason?: string | null;
};

export type AuthorizationDecision = {
  allowed: boolean;
  code: string;
  reason: string;
  action: AuthorizationAction;
  resource: { kind: string; id: string | null; projectId: string | null; tool: string | null };
  contributors: Array<{ source: string; id?: string | null; effect: "allow" | "deny" | "limit"; detail: string }>;
  requiredElevationScope: string | null;
  disclosure: DisclosureObligation[];
  evaluatedAt: string;
};

export type AuthorizationContext = {
  tool?: ClusterToolPermissionKey | string | null;
  minimum?: "view" | "contribute" | "manage" | string;
  rules?: any[] | null;
  requiredElevationScope?: string | null;
  disclosure?: DisclosureObligation[];
  surface?: DisclosureSurface;
};

export function minimumForAuthorizationAction(action: AuthorizationAction) {
  if (action === "manage" || action === "admin") return "manage";
  if (action === "contribute") return "contribute";
  return "view";
}

export function decisionResource(resource: AuthorizationResource) {
  if (resource.kind === "tool") return { kind: resource.kind, id: null, projectId: null, tool: String(resource.tool) };
  if (resource.kind === "project") return { kind: resource.kind, id: String(resource.project?.id || "") || null, projectId: String(resource.project?.id || "") || null, tool: null };
  if (resource.kind === "target") return { kind: resource.targetKind, id: String(resource.targetId || "") || null, projectId: String(resource.project?.id || "") || null, tool: null };
  if (resource.kind === "user") return { kind: resource.kind, id: String(resource.ownerUserId || "") || null, projectId: null, tool: String(resource.tool) };
  return { kind: resource.kind, id: resource.id ? String(resource.id) : null, projectId: null, tool: null };
}
