import type { KeyboardEventHandler } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import type { QuickCreateMode } from "../application/application-models";
import type { CreateModeCatalogItem, CreateModeGroup } from "./create-mode-catalog";

type FilteredCreateModeGroup = Omit<CreateModeGroup, "modes"> & { modes: QuickCreateMode[] };

export function SharedCreateModePicker({
  query,
  normalizedQuery,
  visibleModeIds,
  modes,
  filteredGroups,
  recentModes,
  activeMode,
  showSpecializedModes,
  specializedModeCount,
  onToggleSpecializedModes,
  onQueryChange,
  onClearQuery,
  onActivateMode,
  onChooseMode,
  onCreateAnnouncement,
  onClose,
  onKeyDown,
}: {
  query: string;
  normalizedQuery: string;
  visibleModeIds: QuickCreateMode[];
  modes: CreateModeCatalogItem[];
  filteredGroups: FilteredCreateModeGroup[];
  recentModes: CreateModeCatalogItem[];
  activeMode: QuickCreateMode;
  showSpecializedModes: boolean;
  specializedModeCount: number;
  onToggleSpecializedModes: () => void;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
  onActivateMode: (mode: QuickCreateMode) => void;
  onChooseMode: (mode: QuickCreateMode) => void;
  onCreateAnnouncement?: () => void;
  onClose: () => void;
  onKeyDown: KeyboardEventHandler<HTMLElement>;
}) {
  const announcementMatch = Boolean(onCreateAnnouncement) && (!normalizedQuery || ["announcement", "broadcast", "news", "communication", "studio update"].some((word) => word.includes(normalizedQuery)));
  return (
    <main className="shared-create-picker-v455 shared-create-picker-v466" onKeyDown={onKeyDown}>
      <header className="shared-create-picker-header-v455 shared-create-picker-header-v457">
        <div><span>Create</span><h2 id="shared-create-title-v370">New item</h2></div>
        <ClusterButton variant="quiet" size="compact" className="shared-create-close-v448" onClick={onClose} aria-label="Close item creator">
          <ClusterIcon name="close" />
        </ClusterButton>
      </header>
      <div className="shared-create-search-v457 shared-create-search-v466">
        <ClusterIcon name="search" />
        <ClusterTextInput autoFocus type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search item types" aria-label="Search item types" />
        {normalizedQuery ? <span className="shared-create-search-count-v466" aria-live="polite">{visibleModeIds.length + (announcementMatch ? 1 : 0)}</span> : null}
        {query ? <ClusterButton variant="quiet" size="compact" className="" onClick={onClearQuery} aria-label="Clear create search"><ClusterIcon name="close" /></ClusterButton> : null}
      </div>
      <div className="shared-create-picker-scroll-v455 shared-create-picker-scroll-v458">
        {!normalizedQuery && recentModes.length > 0 ? <section className="shared-create-recent-v458" aria-label="Recent item types">
          <span>Recent</span>
          <div>{recentModes.map((item) => <ClusterButton variant="quiet" key={`recent-${item.id}`} data-create-mode={item.id} data-active={activeMode === item.id ? "true" : undefined} onMouseEnter={() => onActivateMode(item.id)} onFocus={() => onActivateMode(item.id)} onClick={() => onChooseMode(item.id)}>
            <ClusterIcon name={item.icon} /><span>{item.label}</span>
          </ClusterButton>)}</div>
        </section> : null}
        <div className="shared-create-type-groups-v458">
          {filteredGroups.map((group) => <section key={group.label} className="shared-create-type-group-v458">
            <header><h3>{group.label}</h3><span>{group.detail}</span></header>
            <div className="shared-create-type-list-v458">{group.modes.map((modeId) => {
              const item = modes.find((candidate) => candidate.id === modeId)!;
              return <ClusterButton variant="quiet" key={item.id} data-create-mode={item.id} data-active={activeMode === item.id ? "true" : undefined} onMouseEnter={() => onActivateMode(item.id)} onFocus={() => onActivateMode(item.id)} onClick={() => onChooseMode(item.id)}>
                <span className="create-mode-icon-v448"><ClusterIcon name={item.icon} /></span>
                <span className="shared-create-type-copy-v458"><strong>{item.label}</strong><small>{item.detail}</small></span>
                <ClusterIcon name="chevron-right" className="shared-create-picker-chevron-v455" />
              </ClusterButton>;
            })}</div>
          </section>)}
        </div>
        {announcementMatch && <section className="shared-create-type-group-v458"><header><h3>Communicate</h3><span>Author an announcement in Studio Settings</span></header><div className="shared-create-type-list-v458"><ClusterButton variant="quiet" onClick={onCreateAnnouncement}><span className="create-mode-icon-v448"><ClusterIcon name="bell" /></span><span className="shared-create-type-copy-v458"><strong>Studio announcement</strong><small>Draft, schedule or publish an Inbox announcement with audience controls.</small></span><ClusterIcon name="chevron-right" className="shared-create-picker-chevron-v455" /></ClusterButton></div></section>}
        {filteredGroups.length === 0 && !announcementMatch ? <div className="shared-create-empty-v457"><ClusterIcon name="search" /><strong>No matching item type</strong><span>Try project, ticket, meeting, build, or board.</span></div> : null}
        {!normalizedQuery && specializedModeCount > 0 ? <section className="shared-create-specialized-toggle-v495"><div><strong>{showSpecializedModes ? "All item types" : "Keep first-use choices focused"}</strong><span>{showSpecializedModes ? "Specialized workflows are visible alongside the six everyday creation paths." : "Bug, Build, Meeting, and Whiteboard stay one click away without crowding the main picker."}</span></div><ClusterButton variant="secondary" size="compact" onClick={onToggleSpecializedModes}>{showSpecializedModes ? "Show everyday types" : `More item types · ${specializedModeCount}`}</ClusterButton></section> : null}
      </div>
      <footer className="shared-create-picker-footer-v455 shared-create-picker-footer-v466">
        <span>{normalizedQuery ? `${visibleModeIds.length + (announcementMatch ? 1 : 0)} ${visibleModeIds.length + (announcementMatch ? 1 : 0) === 1 ? "match" : "matches"}` : `${visibleModeIds.length + (announcementMatch ? 1 : 0)} shown · ${modes.length + (onCreateAnnouncement ? 1 : 0)} total`}</span>
        <div className="shared-create-picker-hints-v466" aria-hidden="true"><span><kbd>↑↓</kbd> Navigate</span><span><kbd>Enter</kbd> Select</span><span><kbd>Esc</kbd> Close</span></div>
      </footer>
    </main>
  );
}
