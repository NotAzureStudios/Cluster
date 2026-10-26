import { bindSessionHandoff, unwrapSessionHandoff, type SessionBoundHandoff } from "../../core/session-bound-handoff";
export const CLUSTER_COMMAND_PALETTE_QUERY_EVENT = "cluster:command-palette-query";

let pendingCommandPaletteQuery: SessionBoundHandoff<string> | null = null;

function normalizeCommandPaletteQuery(query: string) {
  return String(query || "").trim().slice(0, 240);
}

export function openCommandPaletteWithQuery(query: string) {
  const normalized = normalizeCommandPaletteQuery(query);
  const handoff = bindSessionHandoff(normalized);
  pendingCommandPaletteQuery = handoff;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cluster-native-command", { detail: { command: "command-palette" } }));
  if (handoff && unwrapSessionHandoff(handoff))
    window.dispatchEvent(new CustomEvent<string>(CLUSTER_COMMAND_PALETTE_QUERY_EVENT, { detail: normalized }));
}

export function readPendingCommandPaletteQuery() {
  const pending = pendingCommandPaletteQuery;
  pendingCommandPaletteQuery = null;
  return unwrapSessionHandoff(pending);
}
