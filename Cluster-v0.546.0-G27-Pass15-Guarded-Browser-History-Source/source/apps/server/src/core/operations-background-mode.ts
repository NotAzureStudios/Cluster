import type { ClusterRuntimeAccessMode } from "./runtime-access-state.js";

/** Never infer permission for internal mutations from a healthy HTTP listener.
 * The request-level maintenance fence does not protect background timers.
 * This gate applies only to background operations that can write/prune data;
 * diagnostic reads and native recovery evidence may continue independently.
 */
export function mayRunBackgroundMutation(input: {
  mode: ClusterRuntimeAccessMode;
  ready: boolean;
  draining: boolean;
}) {
  return input.mode === "normal" && input.ready && !input.draining;
}
