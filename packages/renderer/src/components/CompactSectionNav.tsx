import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { focusMenuItem } from "./cluster-menu-navigation";

export type CompactSectionNavItem<Id extends string = string> = {
  id: Id;
  label: string;
  detail?: string;
  detailTone?: "neutral" | "info" | "success" | "warning" | "danger";
  icon?: ClusterIconName;
  group?: string;
};

type Props<Id extends string> = {
  items: CompactSectionNavItem<Id>[];
  activeId: Id;
  onChange: (id: Id) => void;
  primaryIds?: readonly Id[];
  showGroupHeadings?: boolean;
  label: string;
  moreLabel?: string;
  className?: string;
};

export function CompactSectionNav<Id extends string>({
  items,
  activeId,
  onChange,
  primaryIds,
  showGroupHeadings = false,
  label,
  moreLabel = "More",
  className = "",
}: Props<Id>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const moreId = useId();
  const primary = primaryIds?.length
    ? items.filter((item) => primaryIds.includes(item.id))
    : items;
  const secondary = primaryIds?.length
    ? items.filter((item) => !primaryIds.includes(item.id))
    : [];
  const secondaryGroups = useMemo(() => {
    const groups = new Map<string, CompactSectionNavItem<Id>[]>();
    for (const item of secondary) {
      const key = item.group?.trim() || "More";
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }
    return Array.from(groups.entries()).map(([group, groupItems]) => ({ group, items: groupItems }));
  }, [secondary]);

  function select(id: Id) {
    onChange(id);
    setMoreOpen(false);
  }

  function handleKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!primary.length || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const last = primary.length - 1;
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? (index >= last ? 0 : index + 1)
          : (index <= 0 ? last : index - 1);
    buttonRefs.current[next]?.focus();
    select(primary[next].id);
  }

  const secondaryActive = secondary.some((item) => item.id === activeId);
  const activeSecondary = secondary.find((item) => item.id === activeId);

  useEffect(() => {
    const activeIndex = primary.findIndex((item) => item.id === activeId);
    if (activeIndex < 0) return;
    buttonRefs.current[activeIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <nav className={`compact-section-nav-v204 cluster-section-nav-v391 ${className}`.trim()} aria-label={label}>
      <div className="compact-section-primary-v204">
        {primary.map((item, index) => (
          <Fragment key={item.id}>
          {showGroupHeadings && item.group && (index === 0 || primary[index - 1]?.group !== item.group) && (
            <div className="compact-section-group-heading-v103" role="presentation">{item.group}</div>
          )}
          <ClusterButton unstyled
            type="button"
            ref={(node) => { buttonRefs.current[index] = node; }}
            aria-current={activeId === item.id ? "page" : undefined}
            aria-label={item.detail ? `${item.label}, ${item.detail}` : item.label}
            data-cluster-state={activeId === item.id ? "selected" : "default"}
            data-detail-tone={item.detailTone || "neutral"}
            tabIndex={activeId === item.id || (!primary.some((entry) => entry.id === activeId) && index === 0) ? 0 : -1}
            className={activeId === item.id ? "active" : ""}
            onClick={() => select(item.id)}
            onKeyDown={(event) => handleKeys(event, index)}
          >
            {item.icon && <ClusterIcon name={item.icon} treatment="navigation" className="cluster-section-nav-glyph" aria-hidden="true" />}
            <strong>{item.label}</strong>
            {item.detail ? <span aria-hidden="true">{item.detail}</span> : null}
          </ClusterButton>
          </Fragment>
        ))}
      </div>
      {secondary.length > 0 ? (
        <div className="compact-section-more-v204">
          <ClusterButton unstyled type="button" ref={moreTriggerRef}
            data-cluster-state={secondaryActive ? "selected" : "default"}
            className={secondaryActive ? "active" : ""}
            aria-haspopup="menu" aria-expanded={moreOpen}
            aria-controls={moreOpen ? moreId : undefined}
            aria-label={secondaryActive && activeSecondary ? `${moreLabel}: ${activeSecondary.label}` : `${moreLabel} ${label.toLowerCase()}`}
            onClick={() => setMoreOpen((current) => !current)}>
            <span>{moreLabel}</span>
            {secondaryActive && activeSecondary ? <em>{activeSecondary.label}</em> : null}
          </ClusterButton>
          <ClusterFloatingSurface open={moreOpen} anchorRef={moreTriggerRef} surfaceRef={moreMenuRef}
            id={moreId} role="menu" label={`${moreLabel} ${label.toLowerCase()}`}
            placement="bottom-end" mobileMode="sheet" autoFocus="first"
            autoFocusSelector={'button[role="menuitemradio"]:not(:disabled)'}
            className="compact-section-menu-v204"
            onDismiss={() => setMoreOpen(false)}
            onKeyDown={(event) => { if (focusMenuItem(moreMenuRef.current, event.key)) event.preventDefault(); }}>
            {secondaryGroups.map(({ group, items: groupItems }) => (
              <div key={group} className="compact-section-menu-group-v495" role="group" aria-label={group}>
                {secondaryGroups.length > 1 || group !== "More" ? <span className="compact-section-menu-group-label-v495" aria-hidden="true">{group}</span> : null}
                {groupItems.map((item) => (
                  <ClusterButton unstyled key={item.id} type="button" role="menuitemradio"
                    aria-checked={activeId === item.id}
                    data-cluster-state={activeId === item.id ? "selected" : "default"}
                    className={activeId === item.id ? "active" : ""}
                    onClick={() => select(item.id)}>
                    <strong>{item.label}</strong>
                    {item.detail ? <span>{item.detail}</span> : null}
                  </ClusterButton>
                ))}
              </div>
            ))}
          </ClusterFloatingSurface>
        </div>
      ) : null}
    </nav>
  );
}
