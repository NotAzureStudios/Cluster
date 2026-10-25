import { clusterApiFetch } from "@cluster/api-client";
const recent = new Map<string, number>();

export type ClientIncident = {
  kind: string;
  severity?: "info" | "warning" | "error";
  route?: string | null;
  requestId?: string | null;
  message: string;
};

function boundedText(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function reportClientIncident(input: ClientIncident) {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const payload = {
    kind: boundedText(input.kind, 80) || "client.error",
    severity: input.severity || "error",
    route: boundedText(input.route || window.location.pathname, 240) || null,
    requestId: boundedText(input.requestId, 96) || null,
    message: boundedText(input.message, 2_000) || "Unknown client error",
  };
  const fingerprint = `${payload.kind}:${payload.route}:${payload.message.slice(0, 240)}`;
  const now = Date.now();
  const previous = recent.get(fingerprint) || 0;
  if (now - previous < 30_000) return;
  recent.set(fingerprint, now);
  if (recent.size > 100) {
    const oldest = recent.keys().next().value;
    if (oldest) recent.delete(oldest);
  }
  void clusterApiFetch("/api/security/client-incidents", {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

export function installGlobalClientIncidentHandlers() {
  if (typeof window === "undefined") return () => undefined;
  const onError = (event: ErrorEvent) => reportClientIncident({
    kind: "client.window_error",
    message: event.error instanceof Error ? event.error.message : event.message,
    route: window.location.pathname,
  });
  const onRejection = (event: PromiseRejectionEvent) => reportClientIncident({
    kind: "client.unhandled_rejection",
    message: event.reason instanceof Error ? event.reason.message : String(event.reason || "Unhandled promise rejection"),
    route: window.location.pathname,
  });
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
