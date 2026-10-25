import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const text = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
let total = 0;
let failed = 0;
const check = (label, ok) => {
  total += 1;
  if (ok) console.log(`PASS ${label}`);
  else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
};

const entry = text("packages/renderer/src/styles.css");
const responsive = text("packages/renderer/src/styles/responsive-v456.css");
const notifications = text("packages/renderer/src/features/notifications/NotificationInboxPage.tsx");
const admin = text("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");

check("v456 responsive layer is imported", entry.includes('@import "./styles/responsive-v456.css";'));
check("responsive layer stays before production UI", entry.indexOf("responsive-v456.css") < entry.indexOf("production-ui.css"));
check("tablet breakpoint is explicit", responsive.includes("@media (max-width: 1199px)"));
check("phone breakpoint is explicit", responsive.includes("@media (max-width: 767px)"));
check("small-phone breakpoint is explicit", responsive.includes("@media (max-width: 430px)"));
check("iPad people management preserves a two-pane mode", responsive.includes("@media (min-width: 900px) and (max-width: 1199px)"));
check("people management gains a compact detail sheet", responsive.includes("detail-open-v456") && responsive.includes("user-admin-mobile-close-v456"));
check("people management exposes the detail state in JSX", admin.includes('detail-open-v456') && admin.includes('user-admin-mobile-close-v456'));
check("notification lanes become horizontally scrollable on phone", responsive.includes("notification-lanes-v251 nav") && responsive.includes("overflow-x: auto"));
check("notification digest is not forced open", !notifications.includes('notification-digest-v387" open'));
check("scheduler has tablet clock layout", responsive.includes("time-clock-dock-v212") && responsive.includes("time-clock-composer-v212"));
check("scheduler uses the studio accent", responsive.includes("--time-accent: var(--studio-primary, var(--accent))"));
check("library has mobile result-first layout", responsive.includes("library-browser-grid-v217.library-browser-grid-v429") && responsive.includes("library-sidebar-v217"));
check("settings collapse field grids on phone", responsive.includes("server-config-fields-v238") && responsive.includes("settings-field-grid-v092"));
check("project-heavy tools get a safe single-column fallback", responsive.includes("project-overview-grid-v147") && responsive.includes("tickets-main-grid-v184") && responsive.includes("timeline-overview-grid-v118"));
check("phone inputs avoid iOS focus zoom", responsive.includes("font-size: 16px"));
check("responsive layer adds no important overrides", !responsive.includes("!important"));
check("responsive layer adds no raw hex colors", !/#(?:[0-9a-fA-F]{3,8})\b/.test(responsive));

console.log(`\nResponsive layout v0.456 audit: ${total - failed}/${total} checks passed.`);
if (failed) process.exit(1);
