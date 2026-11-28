import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { useServerState } from "../../core/server-state";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterIconButton } from "../../components/ClusterButton";
import "./home-banners.css";

type Banner = { id: string; title: string; body: string; priority: string; bannerEndsAt: string | null };

/** Announcements flagged for Home (maintenance windows and the like).
 *  Dismissing hides a banner for this person only. */
export function HomeBanners() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [dismissed, setDismissed] = useServerState<string[]>("user", "home.dismissed-banners", [], { merge: (value) => Array.isArray(value) ? value.map(String).slice(-50) : [] });
  useEffect(() => {
    let live = true;
    const load = () => void api<{ banners: Banner[] }>("/api/announcements/banners").then((value) => { if (live) setBanners(value.banners); }).catch(() => undefined);
    load();
    const timer = window.setInterval(load, 120_000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  const visible = banners.filter((banner) => !dismissed.includes(banner.id));
  if (!visible.length) return null;
  return <div className="home-banners">
    {visible.map((banner) => <div key={banner.id} className="home-banner" data-priority={banner.priority} role="status">
      <ClusterIcon name="bell" />
      <button type="button" className="home-banner__text" onClick={() => { window.location.hash = "chat"; }}>
        <strong>{banner.title}</strong><span>{banner.body.replace(/[#*_`>\[\]]/g, "").split("\n").find((line) => line.trim()) || ""}</span>
        {banner.bannerEndsAt ? <small>until {new Date(banner.bannerEndsAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small> : null}
      </button>
      <ClusterIconButton label="Dismiss" size="compact" variant="quiet" onClick={() => setDismissed([...dismissed, banner.id])}><ClusterIcon name="close" /></ClusterIconButton>
    </div>)}
  </div>;
}
