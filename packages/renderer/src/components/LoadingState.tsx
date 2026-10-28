type LoadingStateProps = {
  label?: string;
  rows?: number;
  compact?: boolean;
  className?: string;
};

export function LoadingState({ label = "Loading workspace", rows = 5, compact = false, className = "" }: LoadingStateProps) {
  return (
    <section data-motion-purpose="decorative" className={`cluster-skeleton cluster-loading-state-v289 ${compact ? "compact" : ""} ${className}`.trim()} role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only-v204">{label}</span>
      <div className="cluster-loading-heading-v289" aria-hidden="true">
        <i className="skeleton-line skeleton-line-heading" />
        <i className="skeleton-line skeleton-line-subheading" />
      </div>
      <div className="cluster-loading-rows-v289" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index}>
            <i className="cluster-loading-avatar-v289 skeleton-shape" />
            <span>
              <i className="skeleton-line skeleton-line-primary" />
              <i className="skeleton-line skeleton-line-secondary" />
            </span>
            <i className="cluster-loading-meta-v289 skeleton-shape" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function CardGridLoadingState({ label = "Loading cards", cards = 6 }: { label?: string; cards?: number }) {
  return (
    <section data-motion-purpose="decorative" className="cluster-skeleton cluster-card-grid-skeleton-v390" role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only-v204">{label}</span>
      {Array.from({ length: cards }, (_, index) => (
        <article key={index} aria-hidden="true">
          <i className="skeleton-line skeleton-line-heading" />
          <i className="skeleton-line skeleton-line-primary" />
          <i className="skeleton-line skeleton-line-secondary" />
          <div><i className="skeleton-pill" /><i className="skeleton-pill short" /></div>
        </article>
      ))}
    </section>
  );
}

export function SettingsLoadingState({ label = "Loading settings" }: { label?: string }) {
  return (
    <main data-motion-purpose="decorative" className="cluster-skeleton cluster-settings-skeleton-v390" role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only-v204">{label}</span>
      <header aria-hidden="true"><div><i className="skeleton-shape skeleton-logo" /><span><i className="skeleton-line skeleton-line-heading" /><i className="skeleton-line skeleton-line-secondary" /></span></div><i className="skeleton-button" /></header>
      <div className="cluster-settings-skeleton-body-v390" aria-hidden="true">
        <aside>{Array.from({ length: 7 }, (_, index) => <i key={index} className="skeleton-nav" />)}</aside>
        <section>{Array.from({ length: 4 }, (_, index) => <article key={index}><i className="skeleton-line skeleton-line-heading" /><i className="skeleton-line skeleton-line-primary" /><i className="skeleton-input" /><i className="skeleton-input" /></article>)}</section>
      </div>
    </main>
  );
}

export function PolicyLoadingState({ label = "Loading policy" }: { label?: string }) {
  return (
    <main data-motion-purpose="decorative" className="cluster-skeleton cluster-policy-skeleton-v390" role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only-v204">{label}</span>
      <section aria-hidden="true">
        <i className="skeleton-pill" />
        <i className="skeleton-line skeleton-line-title" />
        <i className="skeleton-line skeleton-line-primary" />
        <i className="skeleton-line skeleton-line-secondary" />
        {Array.from({ length: 4 }, (_, index) => <article key={index}><i className="skeleton-line skeleton-line-heading" /><i className="skeleton-line skeleton-line-primary" /><i className="skeleton-line skeleton-line-primary" /><i className="skeleton-line skeleton-line-secondary" /></article>)}
      </section>
    </main>
  );
}

export function WorkspaceLoadingState() {
  return (
    <main data-motion-purpose="decorative" className="cluster-skeleton cluster-workspace-loading-v289" role="status" aria-live="polite" aria-label="Loading Cluster workspace">
      <aside aria-hidden="true">
        <i className="cluster-loading-logo-v289 skeleton-shape" />
        {Array.from({ length: 8 }, (_, index) => <i key={index} className="skeleton-nav" />)}
      </aside>
      <section aria-hidden="true">
        <header>
          <i className="skeleton-button" />
          <i className="skeleton-button" />
          <i className="skeleton-button" />
        </header>
        <div className="cluster-workspace-loading-content-v289">
          <i className="cluster-loading-title-v289 skeleton-line" />
          <i className="cluster-loading-subtitle-v289 skeleton-line" />
          <div>
            {Array.from({ length: 6 }, (_, index) => <i key={index} className="skeleton-shape" />)}
          </div>
        </div>
      </section>
      <span className="sr-only-v204">Loading studio workspace…</span>
    </main>
  );
}

export function TableLoadingState({ label = "Loading records", rows = 8, columns = 5, compact = false }: { label?: string; rows?: number; columns?: number; compact?: boolean }) {
  const safeColumns = Math.max(2, Math.min(7, Math.round(columns)));
  return (
    <section data-motion-purpose="decorative" className={`cluster-skeleton cluster-table-skeleton-v436 ${compact ? "compact" : ""}`} data-columns={safeColumns} role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only-v204">{label}</span>
      <div className="cluster-table-skeleton-head-v436" aria-hidden="true">
        {Array.from({ length: safeColumns }, (_, index) => <i key={index} className="skeleton-line" />)}
      </div>
      <div className="cluster-table-skeleton-body-v436" aria-hidden="true">
        {Array.from({ length: rows }, (_, row) => <div key={row}>{Array.from({ length: safeColumns }, (_, column) => <i key={column} className="skeleton-line" />)}</div>)}
      </div>
    </section>
  );
}

export function InspectorLoadingState({ label = "Loading details", compact = false }: { label?: string; compact?: boolean }) {
  return (
    <section data-motion-purpose="decorative" className={`cluster-skeleton cluster-inspector-skeleton-v436 ${compact ? "compact" : ""}`} role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only-v204">{label}</span>
      <header aria-hidden="true"><i className="skeleton-shape" /><span><i className="skeleton-line skeleton-line-heading" /><i className="skeleton-line skeleton-line-secondary" /></span></header>
      <div className="cluster-inspector-skeleton-tabs-v436" aria-hidden="true"><i className="skeleton-pill" /><i className="skeleton-pill short" /><i className="skeleton-pill short" /></div>
      <div className="cluster-inspector-skeleton-body-v436" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <div key={index}><i className="skeleton-line skeleton-line-secondary" /><i className="skeleton-input" /></div>)}</div>
    </section>
  );
}

export function BoardLoadingState({ label = "Loading board", columns = 4 }: { label?: string; columns?: number }) {
  const safeColumns = Math.max(2, Math.min(6, Math.round(columns)));
  return (
    <section data-motion-purpose="decorative" className="cluster-skeleton cluster-board-skeleton-v496" role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only-v204">{label}</span>
      {Array.from({ length: safeColumns }, (_, column) => (
        <article key={column} aria-hidden="true">
          <i className="skeleton-line skeleton-line-heading" />
          {Array.from({ length: column % 2 ? 3 : 4 }, (_, card) => <div key={card}><i className="skeleton-line skeleton-line-primary" /><i className="skeleton-line skeleton-line-secondary" /><i className="skeleton-pill short" /></div>)}
        </article>
      ))}
    </section>
  );
}

export function TimelineLoadingState({ label = "Loading timeline", rows = 7 }: { label?: string; rows?: number }) {
  return (
    <section data-motion-purpose="decorative" className="cluster-skeleton cluster-timeline-skeleton-v496" role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only-v204">{label}</span>
      {Array.from({ length: rows }, (_, index) => <div key={index} aria-hidden="true"><i className="skeleton-shape" /><span><i className="skeleton-line skeleton-line-primary" /><i className="skeleton-line skeleton-line-secondary" /></span></div>)}
    </section>
  );
}

export function CanvasLoadingState({ label = "Loading canvas" }: { label?: string }) {
  return (
    <section data-motion-purpose="decorative" className="cluster-skeleton cluster-canvas-skeleton-v496" role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only-v204">{label}</span>
      <div aria-hidden="true"><i className="skeleton-button" /><i className="skeleton-button" /><i className="skeleton-button" /></div>
      <main aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} className="skeleton-shape" />)}</main>
    </section>
  );
}

export function InlineLoadingState({ label = "Loading", lines = 3, className = "" }: { label?: string; lines?: number; className?: string }) {
  const safeLines = Math.max(1, Math.min(6, Math.round(lines)));
  return (
    <div data-motion-purpose="decorative" className={`cluster-skeleton cluster-inline-loading-v497 ${className}`.trim()} role="status" aria-live="polite" aria-label={label} aria-busy="true">
      <span className="sr-only-v204">{label}</span>
      <div aria-hidden="true">
        {Array.from({ length: safeLines }, (_, index) => <i key={index} className={`skeleton-line ${index === 0 ? "skeleton-line-primary" : index === safeLines - 1 ? "skeleton-line-secondary" : ""}`.trim()} />)}
      </div>
    </div>
  );
}

/** Match the skeleton to the destination workspace, not the previous route's generic rows. */
export function ScreenLoadingState({ screen }: { screen: string }) {
  if (["settings", "studioSettings", "serverConfig", "toolInfrastructure"].includes(screen)) return <SettingsLoadingState label="Loading settings" />;
  if (["board"].includes(screen)) return <BoardLoadingState label="Loading board" columns={4} />;
  if (["whiteboard"].includes(screen)) return <CanvasLoadingState label="Loading whiteboard" />;
  if (screen === "inventory") return <InventoryLoadingState />;
  if (screen === "vault") return <VaultLoadingState />;
  if (["projects", "library", "packets", "myRecords"].includes(screen)) return <CardGridLoadingState label={`Loading ${screen}`} cards={6} />;
  if (["tickets", "activity", "inbox", "people", "admin"].includes(screen)) return <TableLoadingState label={`Loading ${screen}`} rows={7} columns={5} />;
  if (["calendar", "timeline", "scheduler"].includes(screen)) return <TimelineLoadingState label={`Loading ${screen}`} rows={7} />;
  if (["mywork", "dashboard"].includes(screen)) return <DashboardLoadingState label={screen === "mywork" ? "Loading My Work" : "Loading dashboard"} />;
  return <LoadingState label="Loading workspace" rows={5} className="route-lazy-loading-v518" />;
}

export function DashboardLoadingState({ label = "Loading dashboard" }: { label?: string }) {
  return <section className="cluster-skeleton cluster-dashboard-skeleton-v547" role="status" aria-live="polite" aria-label={label}>
    <span className="sr-only-v204">{label}</span>
    <div className="cluster-dashboard-skeleton-summary-v547" aria-hidden="true">
      <i className="skeleton-line skeleton-line-heading" />
      <div>{Array.from({ length: 4 }, (_, i) => <article key={i}><i className="skeleton-line skeleton-line-secondary"/><i className="skeleton-line skeleton-line-heading" /></article>)}</div>
    </div>
    <div className="cluster-dashboard-skeleton-columns-v547" aria-hidden="true">
      <section><i className="skeleton-line skeleton-line-heading" />{Array.from({length: 4},(_,i)=><article key={i}><i className="skeleton-line skeleton-line-primary" /><i className="skeleton-line skeleton-line-secondary" /></article>)}</section>
      <section>{Array.from({length: 3},(_,i)=><article key={i}><i className="skeleton-line skeleton-line-heading" /><i className="skeleton-line skeleton-line-secondary" /></article>)}</section>
    </div>
  </section>;
}

/** Header, filters and resources follow the Inventory workspace rather than a generic list. */
export function InventoryLoadingState() {
  return <section className="cluster-skeleton cluster-resource-loading-v547" role="status" aria-live="polite" aria-label="Loading Inventory">
    <span className="sr-only-v204">Loading Inventory</span>
    <div aria-hidden="true" className="cluster-resource-loading-header-v547"><i className="skeleton-line skeleton-line-title"/><i className="skeleton-line skeleton-line-secondary"/></div>
    <nav aria-hidden="true">{Array.from({length: 4},(_,i)=><i className="skeleton-pill" key={i}/>)}</nav>
    <section aria-hidden="true"><i className="skeleton-line skeleton-line-heading"/><i className="skeleton-button"/><div className="cluster-resource-loading-grid-v547">{Array.from({length: 3},(_,i)=><i key={i} className="skeleton-shape" />)}</div></section>
  </section>;
}
/** Vault has a search/filter row, left metadata list, and right detail/rotation panels. */
export function VaultLoadingState() {
  return <section className="cluster-skeleton cluster-resource-loading-v547" role="status" aria-live="polite" aria-label="Loading Vault">
    <span className="sr-only-v204">Loading Vault</span>
    <div aria-hidden="true" className="cluster-resource-loading-header-v547"><i className="skeleton-line skeleton-line-title"/><i className="skeleton-line skeleton-line-secondary"/></div>
    <div aria-hidden="true" className="cluster-resource-loading-toolbar-v547"><i className="skeleton-input"/><i className="skeleton-input"/><i className="skeleton-button"/></div>
    <div aria-hidden="true" className="cluster-resource-loading-vault-v547"><section>{Array.from({length: 5},(_,i)=><i key={i} className="skeleton-nav"/>)}</section><section>{Array.from({length: 3},(_,i)=><article key={i}><i className="skeleton-line skeleton-line-heading"/><i className="skeleton-line skeleton-line-secondary"/><i className="skeleton-input"/></article>)}</section></div>
  </section>;
}
