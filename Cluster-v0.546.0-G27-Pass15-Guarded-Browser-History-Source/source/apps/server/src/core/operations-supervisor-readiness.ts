import type { ClusterRuntimeAccessMode } from "./runtime-access-state.js";

/**
 * Independent native-supervisor liveness/readiness signal.
 * /health/ready is a CLIENT ADMISSION signal: intentional maintenance/recovery
 * is 503 there even when the managed service has booted correctly.
 * Do not restart a functional service simply because users are held.
 */
export function supervisorReadiness(input: {
  serverReady: boolean;
  draining: boolean;
  mode: ClusterRuntimeAccessMode;
  database: { ok: boolean } | null;
  storage: { ok: boolean } | null;
}) {
  const dependencyReady = input.database?.ok === true && input.storage?.ok === true;
  const ready = input.serverReady && !input.draining && dependencyReady;
  return {
    ok: ready,
    ready,
    state: input.draining ? "draining" : !input.serverReady ? "starting" : !dependencyReady ? "dependency-unavailable" : input.mode,
    mode: input.mode,
    workspaceAvailable: ready && (input.mode === "normal" || input.mode === "read-only"),
    acceptsMutations: ready && input.mode === "normal",
    dependencies: { database: input.database?.ok === true, storage: input.storage?.ok === true },
    // This route is a trusted local host readiness contract, not an assertion
    // that public gateway/DNS/TLS is reachable or that queued work is safe.
    contract: "cluster-supervisor-readiness-v1" as const,
  };
}
