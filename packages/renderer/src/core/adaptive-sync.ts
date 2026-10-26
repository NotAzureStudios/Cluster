export type AdaptiveSyncMode = "offline" | "recovering" | "saving" | "active" | "idle" | "background" | "data-saver";

export type AdaptiveSyncInput = {
  online: boolean;
  serverReachable: boolean;
  pending: number;
  conflicts: number;
  failed: number;
  consecutiveFailures: number;
  hidden: boolean;
  saveData: boolean;
  effectiveType?: string | null;
  lastPullChanges: number;
};

export type AdaptiveSyncPlan = {
  mode: AdaptiveSyncMode;
  delayMs: number;
  flush: boolean;
  pull: boolean;
  checkServer: boolean;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function jitter(value: number, random: number) {
  const normalized = clamp(random, 0, 1);
  return Math.round(value * (0.9 + normalized * 0.2));
}

export function computeAdaptiveSyncPlan(input: AdaptiveSyncInput, random = Math.random()): AdaptiveSyncPlan {
  if (!input.online) {
    return { mode: "offline", delayMs: jitter(60_000, random), flush: false, pull: false, checkServer: false };
  }

  if (!input.serverReachable) {
    const retry = clamp(4_000 * 2 ** Math.min(input.consecutiveFailures, 5), 4_000, 120_000);
    return { mode: "recovering", delayMs: jitter(retry, random), flush: input.pending > 0, pull: false, checkServer: true };
  }

  const constrained = input.saveData || ["slow-2g", "2g"].includes(String(input.effectiveType || ""));
  if (input.pending > 0) {
    return {
      mode: "saving",
      delayMs: jitter(constrained ? 4_000 : 1_500, random),
      flush: true,
      pull: !input.hidden && !constrained,
      checkServer: true,
    };
  }

  if (input.hidden) {
    return { mode: "background", delayMs: jitter(5 * 60_000, random), flush: false, pull: true, checkServer: true };
  }

  if (constrained) {
    return { mode: "data-saver", delayMs: jitter(3 * 60_000, random), flush: false, pull: true, checkServer: true };
  }

  if (input.lastPullChanges > 0) {
    return { mode: "active", delayMs: jitter(15_000, random), flush: false, pull: true, checkServer: true };
  }

  if (input.conflicts > 0 || input.failed > 0) {
    return { mode: "idle", delayMs: jitter(45_000, random), flush: false, pull: true, checkServer: true };
  }

  return { mode: "idle", delayMs: jitter(90_000, random), flush: false, pull: true, checkServer: true };
}
