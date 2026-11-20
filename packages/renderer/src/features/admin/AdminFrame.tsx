import { useMemo, useState, type ReactNode } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { SettingsShellHostContext, settingsSectionIcon, type SettingsPageNav } from "../../components/SettingsWorkspaceShell";
import "./admin-frame.css";

/* The Admin workspace. One place for everything an owner or admin runs:
   a single navigation down the left, grouped, with the open page's own
   sections nested under it. Studio and Server settings render inside it
   without their own navigation (SettingsWorkspaceShell publishes its
   sections here instead). The sidebar shows one Admin entry. */

export type AdminScreen = "admin" | "people" | "studioSettings" | "serverConfig" | "integrations" | "toolInfrastructure" | "vault";
export const ADMIN_FRAME_SCREENS: readonly string[] = ["admin", "studioSettings", "serverConfig", "integrations", "toolInfrastructure", "vault"];

type Entry = { screen: AdminScreen; section?: string; label: string; icon: ClusterIconName; group: string };
const ENTRIES: Entry[] = [
  { screen: "admin", label: "Overview", icon: "operations", group: "" },
  { screen: "people", section: "admin", label: "Users", icon: "users", group: "" },
  { screen: "studioSettings", label: "Studio", icon: "settings", group: "Settings" },
  { screen: "serverConfig", label: "Server", icon: "cloud", group: "Settings" },
  { screen: "integrations", label: "Integrations", icon: "link", group: "Tools" },
  { screen: "toolInfrastructure", label: "Tool infrastructure", icon: "tools", group: "Tools" },
  { screen: "vault", label: "Vault", icon: "lock", group: "Tools" },
];

export function AdminFrame({ screen, section, onNavigate, children }: {
  screen: string;
  section?: string | null;
  onNavigate: (screen: AdminScreen, section?: string) => void;
  children: ReactNode;
}) {
  const [pageNav, setPageNav] = useState<SettingsPageNav | null>(null);
  const host = useMemo(() => ({ publish: setPageNav }), []);
  const isActive = (entry: Entry) => entry.screen === screen && (!entry.section || entry.section === section);
  const groups = ENTRIES.reduce<Array<[string, Entry[]]>>((list, entry) => {
    const found = list.find(([name]) => name === entry.group);
    if (found) found[1].push(entry); else list.push([entry.group, [entry]]);
    return list;
  }, []);
  return <div className="adm">
    <nav className="adm-nav" aria-label="Admin">
      <h1 className="adm-nav__title">Admin</h1>
      {groups.map(([group, entries]) => <div key={group || "_"} className="adm-nav__group">
        {group ? <h2>{group}</h2> : null}
        {entries.map((entry) => {
          const active = isActive(entry);
          const nested = active && pageNav && pageNav.items.length > 1 ? pageNav : null;
          return <div key={entry.label} className="adm-nav__entry" data-open={nested ? true : undefined}>
            <ClusterButton unstyled type="button" className={`adm-nav__item ${active ? "is-active" : ""}`.trim()} aria-current={active && !nested ? "page" : undefined} onClick={() => onNavigate(entry.screen, entry.section)}>
              <ClusterIcon name={entry.icon} /><span>{entry.label}</span>
              {active && pageNav && pageNav.items.length > 1 ? <ClusterIcon name="chevron-down" className="adm-nav__chev" /> : null}
            </ClusterButton>
            {nested ? <SectionList nav={nested} /> : null}
          </div>;
        })}
      </div>)}
    </nav>
    <div className="adm-main">
      <SettingsShellHostContext.Provider value={host}>{children}</SettingsShellHostContext.Provider>
    </div>
  </div>;
}

function SectionList({ nav }: { nav: SettingsPageNav }) {
  const groups = nav.items.reduce<Array<[string, SettingsPageNav["items"]]>>((list, item) => {
    const name = item.group || "";
    const found = list.find(([group]) => group === name);
    if (found) found[1].push(item); else list.push([name, [item]]);
    return list;
  }, []);
  return <div className="adm-sub">
    {groups.map(([group, items]) => <div key={group || "_"} className="adm-sub__group">
      {group && groups.length > 1 ? <h3>{group}</h3> : null}
      {items.map((item) => <ClusterButton unstyled type="button" key={item.id}
        className={`adm-sub__item ${item.id === nav.activeId ? "is-active" : ""}`.trim()}
        aria-current={item.id === nav.activeId ? "page" : undefined}
        title={item.detail ? `${item.label} · ${item.detail}` : item.label}
        onClick={() => nav.onChange(item.id)}>
        <ClusterIcon name={settingsSectionIcon(item)} /><span>{item.label}</span>
        {item.detailTone === "warning" || item.detailTone === "danger" ? <i data-tone={item.detailTone} /> : null}
      </ClusterButton>)}
    </div>)}
  </div>;
}
