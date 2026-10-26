export const CLUSTER_MOTION_PURPOSES = [
  "feedback",
  "state",
  "surface",
  "layout",
  "navigation",
  "spatial",
  "progress",
  "decorative",
  "essential",
] as const;

export type ClusterMotionPurpose = (typeof CLUSTER_MOTION_PURPOSES)[number];
export type ClusterMotionMode = "full" | "reduced" | "none";

export function readClusterMotionMode(root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement): ClusterMotionMode {
  const value = root?.dataset.motion;
  return value === "reduced" || value === "none" ? value : "full";
}

export function clusterMotionBehavior(purpose: ClusterMotionPurpose, mode: ClusterMotionMode = readClusterMotionMode()) {
  if (mode === "none") return { animate: false, smoothScroll: false, duration: 0 } as const;
  if (mode === "reduced") {
    const preserve = purpose === "feedback" || purpose === "state" || purpose === "progress" || purpose === "essential";
    return { animate: preserve, smoothScroll: false, duration: preserve ? 80 : 0 } as const;
  }
  const duration = purpose === "feedback" ? 100
    : purpose === "state" ? 140
      : purpose === "surface" ? 180
        : purpose === "layout" ? 220
          : purpose === "navigation" ? 200
            : purpose === "spatial" ? 220
              : purpose === "progress" ? 180
                : purpose === "decorative" ? 180
                  : 120;
  return { animate: true, smoothScroll: purpose !== "feedback" && purpose !== "essential", duration } as const;
}

export function clusterMotionData(purpose: ClusterMotionPurpose) {
  return { "data-motion-purpose": purpose } as const;
}
