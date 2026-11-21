import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { ToolPageMetric } from "./ToolPageHeader";
import type { CompactSectionNavItem } from "./CompactSectionNav";
import { ClusterButton } from "./ClusterButton";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";
import "./settings-shell.css";

/* The one layout for every settings page (account, project, studio,
   server). A compact title row with the page's save action; a grouped
   section list on the left that shows every section — no overflow menu —
   and the section's content on the right. Styled by settings-shell.css
   only; the st-* names start clean of the older settings cascades. */

const SECTION_ICONS: Array<[RegExp, ClusterIconName]> = [
  [/profile|identity|account|general|brand/, "user"],
  [/privacy|security|pin|auth|access|permission|role|secret|sso/, "lock"],
  [/notif|alert|digest|mail|email/, "bell"],
  [/appear|theme|visual|layout/, "palette"],
  [/perform|render|speed/, "speed"],
  [/navig|start|search/, "menu"],
  [/home|dashboard/, "home"],
  [/shortcut|keyboard|hotkey/, "keyboard"],
  [/desktop|device|kiosk|window/, "grid"],
  [/form|application|onboard|offboard/, "pages"],
  [/licen|resource|inventory|vault|equipment|package/, "inventory"],
  [/people|user|member|team|crew|department|workforce/, "users"],
  [/integrat|discord|git|webhook|provider|connect|link/, "link"],
  [/storage|file|upload|media|library|backup/, "folder"],
  [/schedul|calendar|time|lifecycle/, "calendar"],
  [/build|delivery|release/, "cloud"],
  [/announce|news|changelog/, "comment"],
  [/system|server|runtime|ops|operation|job|health|log|audit/, "operations"],
  [/project/, "project"],
  [/field|custom/, "list"],
];

/** A page's section list, handed to a host frame (the Admin workspace)
    that draws one navigation for several settings pages. */
export type SettingsPageNav = {
  items: CompactSectionNavItem<string>[];
  activeId: string;
  onChange: (id: string) => void;
};
export const SettingsShellHostContext = createContext<{ publish: (nav: SettingsPageNav | null) => void } | null>(null);

export function settingsSectionIcon(item: CompactSectionNavItem<string>): ClusterIconName {
  return sectionIcon(item);
}

function sectionIcon(item: CompactSectionNavItem<string>): ClusterIconName {
  if (item.icon) return item.icon;
  const key = `${item.id} ${item.label}`.toLowerCase();
  return SECTION_ICONS.find(([pattern]) => pattern.test(key))?.[1] || "settings";
}

/* Sections were written as standalone pages and open with their own title.
   The title row already names the section, so the first heading inside it
   that says the same thing is hidden. "Same" is loose: the first word, with
   a plural s dropped ("Automation rules" under "Automations"). */
const stem = (text: string) => (text.trim().toLowerCase().match(/[a-z]+/)?.[0] || "").replace(/s$/, "");
function useHideRepeatedHeading(main: RefObject<HTMLElement | null>, label: string | undefined) {
  useEffect(() => {
    const root = main.current;
    if (!root || !label) return;
    const target = stem(label);
    const mark = () => {
      root.querySelectorAll("[data-st-dup]").forEach((node) => node.removeAttribute("data-st-dup"));
      const first = root.querySelector("h1, h2, h3");
      if (!first || !target || stem(first.textContent || "") !== target) return;
      first.setAttribute("data-st-dup", "");
      const eyebrow = first.previousElementSibling;
      if (eyebrow?.classList.contains("eyebrow")) eyebrow.setAttribute("data-st-dup", "");
    };
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [main, label]);
}

export function SettingsWorkspaceShell<Id extends string>({
  className = "",
  title,
  icon: _icon,
  description: _description,
  actions,
  metrics: _metrics = [],
  status,
  navLabel,
  activeId,
  onChange,
  primaryIds: _primaryIds,
  showGroupHeadings: _showGroupHeadings = false,
  items,
  navTop,
  inline = false,
  children,
}: {
  className?: string;
  title: string;
  icon?: ClusterIconName | null;
  description?: string;
  actions?: ReactNode;
  metrics?: ToolPageMetric[];
  status?: ReactNode;
  navLabel: string;
  activeId: Id;
  onChange: (id: Id) => void;
  primaryIds?: readonly Id[];
  showGroupHeadings?: boolean;
  items: CompactSectionNavItem<Id>[];
  /** Rendered above the section list, e.g. the settings search. */
  navTop?: ReactNode;
  /** Inside another page (project settings): no title row, just the
      section list beside the content, with actions above the content. */
  inline?: boolean;
  children: ReactNode;
}) {
  const host = useContext(SettingsShellHostContext);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const itemsKey = items.map((item) => `${item.group || ""}:${item.id}:${item.label}:${item.detailTone || ""}`).join("|");
  useEffect(() => {
    if (!host) return;
    host.publish({ items: items as CompactSectionNavItem<string>[], activeId, onChange: (id) => onChangeRef.current(id as Id) });
  }, [host, itemsKey, activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => host ? () => host.publish(null) : undefined, [host]);
  const groups: Array<[string, CompactSectionNavItem<Id>[]]> = [];
  for (const item of items) {
    const group = item.group || "";
    const existing = groups.find(([name]) => name === group);
    if (existing) existing[1].push(item); else groups.push([group, [item]]);
  }
  const active = items.find((item) => item.id === activeId);
  const mainRef = useRef<HTMLDivElement>(null);
  useHideRepeatedHeading(mainRef, active?.label);
  if (host) return (
    <section className={`st st--embedded ${className}`.trim()}>
      <header className="st-head">
        <h1>{active?.label || title}</h1>
        {status ? <span className="st-head__status" role="status">{status}</span> : null}
        {actions ? <div className="st-head__actions">{actions}</div> : null}
      </header>
      <div className="st-main" ref={mainRef}>{children}</div>
    </section>
  );
  const nav = <nav className="st-nav" aria-label={navLabel}>
    {navTop ? <div className="st-nav__top">{navTop}</div> : null}
    {groups.map(([group, groupItems]) => <div key={group || "_"} className="st-nav__group">
      {group && groups.length > 1 ? <h2>{group}</h2> : null}
      {groupItems.map((item) => <ClusterButton unstyled type="button" key={item.id}
        className={`st-nav__item ${item.id === activeId ? "is-active" : ""}`.trim()}
        aria-current={item.id === activeId ? "page" : undefined}
        title={item.detail ? `${item.label} · ${item.detail}` : item.label}
        onClick={() => onChange(item.id)}>
        <ClusterIcon name={sectionIcon(item as CompactSectionNavItem<string>)} />
        <span>{item.label}</span>
        {item.detailTone === "warning" || item.detailTone === "danger" ? <i data-tone={item.detailTone} aria-label={item.detail || "Needs attention"} /> : null}
      </ClusterButton>)}
    </div>)}
  </nav>;
  if (inline) return (
    <div className={`st st--inline ${className}`.trim()}>
      <div className="st-body">
        {nav}
        <div className="st-main" ref={mainRef}>
          {status || actions ? <div className="st-inline-bar">{status ? <span className="st-head__status" role="status">{status}</span> : null}{actions ? <div className="st-head__actions">{actions}</div> : null}</div> : null}
          {children}
        </div>
      </div>
    </div>
  );
  return (
    <section className={`page st ${className}`.trim()}>
      <header className="st-head">
        <h1>{title}</h1>
        {active ? <span className="st-head__crumb" aria-hidden="true"><ClusterIcon name="chevron-right" />{active.label}</span> : null}
        {status ? <span className="st-head__status" role="status">{status}</span> : null}
        {actions ? <div className="st-head__actions">{actions}</div> : null}
      </header>
      <div className="st-body">
        {nav}
        <div className="st-main" ref={mainRef}>{children}</div>
      </div>
    </section>
  );
}
