import type { WhiteboardElement } from "../application/application-models";

/**
 * Connector endpoints are indexed only when the board contents change.
 * Scrolling, panning and zooming should never have to scan every element to
 * preserve connector candidates for the active selection.
 */
export function buildWhiteboardConnectorAdjacency(elements: readonly WhiteboardElement[]): ReadonlyMap<string, readonly string[]> {
  const byEndpoint = new Map<string, string[]>();
  for (const element of elements) {
    if (element.type !== "line" && element.type !== "arrow") continue;
    if (element.fromId) {
      const connected = byEndpoint.get(element.fromId) || [];
      connected.push(element.id);
      byEndpoint.set(element.fromId, connected);
    }
    if (element.toId && element.toId !== element.fromId) {
      const connected = byEndpoint.get(element.toId) || [];
      connected.push(element.id);
      byEndpoint.set(element.toId, connected);
    }
  }
  return byEndpoint;
}

export function selectedWhiteboardConnectorIds(
  selected: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const id of selected) for (const connectorId of adjacency.get(id) || []) result.add(connectorId);
  return result;
}
