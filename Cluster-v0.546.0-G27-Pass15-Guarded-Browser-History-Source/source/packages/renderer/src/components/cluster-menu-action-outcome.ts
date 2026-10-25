/**
 * Menu actions have three meaningful outcomes:
 *   undefined/true: completed (for traditional callbacks and confirmed boolean APIs)
 *   false: explicitly not completed (e.g. clipboard denied, detached window rejected)
 *   throw/reject: failure or uncertain result.
 * Never dismiss a menu when the action explicitly reports that nothing happened.
 */
export type ClusterMenuActionResult = void | boolean;
export type ClusterMenuAction = () => ClusterMenuActionResult | Promise<ClusterMenuActionResult>;

export function requireConfirmedMenuOutcome(value: ClusterMenuActionResult): void {
  if (value === false) throw new Error("The action did not complete.");
}
