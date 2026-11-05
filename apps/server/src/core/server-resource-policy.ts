/**
 * Pure resource scheduling policy. Kept outside the live telemetry/runtime
 * module so it can be tested without starting a server or database.
 */
export type ServerResourceProfile = "automatic" | "interactive-first" | "background-throughput";
export type ServerSaturationMode = "normal" | "busy" | "saturated" | "critical";

export function normalizeServerResourceProfile(value: unknown): ServerResourceProfile {
  return value === "interactive-first" || value === "background-throughput" ? value : "automatic";
}

export function computeGovernedJobConcurrency(input: {
  base: number;
  mode: ServerSaturationMode;
  policyScale: number;
  profile: ServerResourceProfile;
  workerCap: number;
  queued: number | null;
}): number {
  const base = Math.max(1, Math.round(input.base || 1));
  const cap = Number.isFinite(input.workerCap) ? Math.max(1, Math.min(128, Math.floor(input.workerCap))) : 128;
  if (input.mode === "critical") return 0;
  const profile = normalizeServerResourceProfile(input.profile);
  const multiplier = input.mode === "normal"
    ? profile === "interactive-first" ? 0.5 : profile === "background-throughput" ? 1.25 : 1
    : input.mode === "busy" && profile === "interactive-first" ? 0.65 : 1;
  let target = Math.max(1, Math.floor(base * Math.max(0, input.policyScale) * multiplier));
  if (input.mode === "normal" && profile !== "interactive-first" && input.queued !== null && input.queued >= base * 8) {
    target = Math.max(target, Math.ceil(base * 1.25));
  }
  return Math.min(cap, target);
}
