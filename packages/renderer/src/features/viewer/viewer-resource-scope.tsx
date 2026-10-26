import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

type Cleanup = () => void;

class ViewerResourceScopeOwner {
  private cleanups = new Set<Cleanup>();
  private disposed = false;

  register(cleanup: Cleanup) {
    if (this.disposed) {
      cleanup();
      return () => undefined;
    }
    this.cleanups.add(cleanup);
    return () => this.cleanups.delete(cleanup);
  }

  trackObjectUrl(url: string) {
    return this.register(() => URL.revokeObjectURL(url));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of [...this.cleanups].reverse()) {
      try { cleanup(); } catch { /* cleanup must not prevent remaining disposal */ }
    }
    this.cleanups.clear();
  }
}

export type ViewerResourceScope = {
  registerCleanup: (cleanup: Cleanup) => () => void;
  trackObjectUrl: (url: string) => () => void;
};

const ViewerResourceScopeContext = createContext<ViewerResourceScope | null>(null);

export function ViewerResourceScopeProvider({ resourceKey, children }: { resourceKey: string; children: ReactNode }) {
  const owner = useMemo(() => new ViewerResourceScopeOwner(), [resourceKey]);
  const value = useMemo<ViewerResourceScope>(() => ({
    registerCleanup: (cleanup) => owner.register(cleanup),
    trackObjectUrl: (url) => owner.trackObjectUrl(url),
  }), [owner]);

  useEffect(() => () => owner.dispose(), [owner]);
  return <ViewerResourceScopeContext.Provider value={value}>{children}</ViewerResourceScopeContext.Provider>;
}

export function useViewerResourceScope() {
  const scope = useContext(ViewerResourceScopeContext);
  if (!scope) throw new Error("useViewerResourceScope must be used inside ViewerResourceScopeProvider.");
  return scope;
}
