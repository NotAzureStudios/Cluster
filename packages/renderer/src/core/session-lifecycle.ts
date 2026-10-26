export type SessionControlFrame = {
  state?: string | null;
  reason?: string | null;
};

export type SessionControlAction = "invalidate" | "reconnect" | "ignore";

export function sessionControlAction(frame: SessionControlFrame): SessionControlAction {
  const state = String(frame.state || "").trim().toLowerCase();
  if (state === "revoked") return "invalidate";
  if (state === "rotated") return "reconnect";
  return "ignore";
}

export function shouldInvalidateAuthenticatedClientForError(input: {
  status: number;
  code?: string | null;
  path: string;
}) {
  if (input.status !== 401) return false;
  const code = String(input.code || "");
  const terminalDeviceFailure = code === "DEVICE_REVOKED" || code === "DEVICE_BINDING_MISMATCH" || code === "SESSION_REVOKED";
  if (code !== "AUTH_REQUIRED" && !terminalDeviceFailure) return false;
  if (terminalDeviceFailure) return true;
  const path = String(input.path || "/").split("?", 1)[0] || "/";
  if (path.startsWith("/api/auth/")) return false;
  if (path.startsWith("/api/public/")) return false;
  if (path === "/api/setup/status") return false;
  return path.startsWith("/api/");
}
