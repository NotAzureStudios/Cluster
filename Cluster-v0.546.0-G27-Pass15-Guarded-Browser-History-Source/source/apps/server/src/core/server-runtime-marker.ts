import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ClusterServerRuntimeMarker = {
  schemaVersion: 2;
  nodeId: string;
  pid: number;
  hostname: string;
  startedAt: string;
  version?: string | null;
};

function safeNodeSegment(value: string) {
  return String(value || "node").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 96) || "node";
}

export function currentServerNodeId() {
  return `${safeNodeSegment(os.hostname())}-${process.pid}`;
}

export function serverRuntimeMarkerDirectory(runtimeRoot: string) {
  return path.join(path.resolve(runtimeRoot), "server-nodes");
}

export function serverRuntimeMarkerPath(runtimeRoot: string, nodeId = currentServerNodeId()) {
  return path.join(serverRuntimeMarkerDirectory(runtimeRoot), `${safeNodeSegment(nodeId)}.json`);
}

function processAppearsAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code === "EPERM"; }
}

export async function readServerRuntimeMarkers(runtimeRoot: string) {
  const directory = serverRuntimeMarkerDirectory(runtimeRoot);
  let entries: string[] = [];
  try { entries = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")); } catch { return []; }
  const markers = await Promise.all(entries.map(async (name) => {
    const markerPath = path.join(directory, name);
    try {
      const parsed = JSON.parse(await fs.readFile(markerPath, "utf8")) as ClusterServerRuntimeMarker;
      if (!parsed || parsed.schemaVersion !== 2 || !Number.isInteger(parsed.pid) || !parsed.nodeId) return null;
      const localHost = String(parsed.hostname || "").toLowerCase() === os.hostname().toLowerCase();
      return { markerPath, marker: parsed, alive: localHost ? processAppearsAlive(parsed.pid) : true, foreignHost: !localHost };
    } catch { return null; }
  }));
  return markers.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

export async function readServerRuntimeMarker(runtimeRoot: string, nodeId = currentServerNodeId()) {
  const markerPath = serverRuntimeMarkerPath(runtimeRoot, nodeId);
  try {
    const parsed = JSON.parse(await fs.readFile(markerPath, "utf8")) as ClusterServerRuntimeMarker;
    if (!parsed || parsed.schemaVersion !== 2 || !Number.isInteger(parsed.pid)) return { markerPath, marker: null, alive: false };
    const localHost = String(parsed.hostname || "").toLowerCase() === os.hostname().toLowerCase();
    return { markerPath, marker: parsed, alive: localHost ? processAppearsAlive(parsed.pid) : true, foreignHost: !localHost };
  } catch { return { markerPath, marker: null, alive: false }; }
}

export async function writeServerRuntimeMarker(runtimeRoot: string, version?: string | null, nodeId = currentServerNodeId()) {
  const markerPath = serverRuntimeMarkerPath(runtimeRoot, nodeId);
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  const marker: ClusterServerRuntimeMarker = {
    schemaVersion: 2,
    nodeId,
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
    version: version || null,
  };
  const temporary = `${markerPath}.partial-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, markerPath);
  await fs.chmod(markerPath, 0o600).catch(() => undefined);
  return marker;
}

export async function clearServerRuntimeMarker(runtimeRoot: string, nodeId = currentServerNodeId()) {
  const markerPath = serverRuntimeMarkerPath(runtimeRoot, nodeId);
  await fs.rm(markerPath, { force: true });
  return true;
}

export async function assertServerOffline(runtimeRoot: string, options: { clearStaleMarker?: boolean } = {}) {
  const states = await readServerRuntimeMarkers(runtimeRoot);
  const active = states.filter((state) => state.alive);
  if (active.length) {
    const sample = active.slice(0, 4).map((state) => `${state.marker.nodeId} (pid ${state.marker.pid} on ${state.marker.hostname})`).join(", ");
    throw new Error(`Cluster Server has ${active.length} active node${active.length === 1 ? "" : "s"}: ${sample}. Stop every API node before recovery.`);
  }
  if (!states.length) return { ok: true, staleMarkerCleared: false, clearedMarkers: 0 };
  if (!options.clearStaleMarker) throw new Error(`${states.length} stale Cluster Server node marker${states.length === 1 ? " exists" : "s exist"}. Re-run with explicit stale-marker clearance after confirming every server node is stopped.`);
  await Promise.all(states.map((state) => fs.rm(state.markerPath, { force: true })));
  return { ok: true, staleMarkerCleared: true, clearedMarkers: states.length };
}
