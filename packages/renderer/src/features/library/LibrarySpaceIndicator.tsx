import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { formatBytes, SpaceMeter } from "../../components/SpaceMeter";
import "./library-space.css";

type LibrarySpace = { usedBytes: number | null; freeBytes: number | null; totalBytes: number | null };

// Sidebar footer: how much the Library holds and how much room its drive has.
export function LibrarySpaceIndicator() {
  const [space, setSpace] = useState<LibrarySpace | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api<LibrarySpace>("/api/library/storage-space").then((value) => { if (alive) setSpace(value); }).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  if (!space?.totalBytes || space.freeBytes == null) return null;
  return <div className="library-space-v21" title={`Library ${space.usedBytes == null ? "size is being measured" : `uses ${formatBytes(space.usedBytes)}`} · ${formatBytes(space.freeBytes)} free on its drive`}>
    <div><span>Storage</span><small>{formatBytes(space.freeBytes)} free</small></div>
    <SpaceMeter usedBytes={space.totalBytes - space.freeBytes} totalBytes={space.totalBytes} />
  </div>;
}
