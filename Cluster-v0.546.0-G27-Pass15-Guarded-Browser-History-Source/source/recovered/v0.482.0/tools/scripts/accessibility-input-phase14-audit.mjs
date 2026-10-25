import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const text = (relative) => readFile(path.join(root, relative), "utf8");
let passed = 0;
let total = 0;
function check(label, ok) {
  total += 1;
  if (!ok) { console.error(`FAIL  ${label}`); process.exitCode = 1; return; }
  passed += 1;
  console.log(`PASS  ${label}`);
}

const [core, manager, shell, accessibilityCss, settings, app, staticAudit, runtimeCi, docs, pkgText, packager, notes, changelog, webIndex, desktopPrefs] = await Promise.all([
  text("packages/renderer/src/core/accessibility.ts"),
  text("packages/renderer/src/components/AccessibilityManager.tsx"),
  text("packages/renderer/src/features/application/modules/application-shell.tsx"),
  text("packages/renderer/src/styles/accessibility.css"),
  text("packages/renderer/src/features/settings/AccountSettingsPage.tsx"),
  text("packages/renderer/src/App.tsx"),
  text("tools/scripts/accessibility-static-audit.mjs"),
  text("tools/scripts/accessibility-ci.mjs"),
  text("docs/ACCESSIBILITY_INPUT_PHASE14.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.437.0.md"),
  text("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
  text("apps/web/index.html"),
  text("apps/desktop-qt/src/DesktopPreferences.cpp"),
]);

check("Editable-target helper exists", core.includes("export function isEditableTarget"));
check("Editable helper covers native form controls", core.includes('input, textarea, select'));
check("Editable helper covers contenteditable", core.includes("target.isContentEditable") && core.includes("[contenteditable='true']"));
check("Global navigation guard rejects composition/default-prevented events", core.includes("event.defaultPrevented || event.isComposing"));
check("Desktop Alt navigation uses global editable guard", shell.includes("shouldHandleGlobalNavigationShortcut(event)"));
check("Desktop Alt navigation still supports Back and Forward", shell.includes('event.key === "ArrowLeft"') && shell.includes('event.key === "ArrowRight"'));

check("Global skip link remains present", app.includes("skip-link-v204") && app.includes("#cluster-main-content"));
check("Main focus target remains stable", app.includes("cluster-main-content"));
check("Modal focus selector remains explicit", manager.includes("[role='dialog'][aria-modal='true']"));
check("Modal focus trap remains active", manager.includes("function trapDialogFocus") && manager.includes('event.key !== "Tab"'));
check("Modal isolation remains inert plus aria-hidden", manager.includes('setAttribute("inert"') && manager.includes('setAttribute("aria-hidden", "true")'));
check("Dialog observer tracks semantic visibility attributes", manager.includes('"open", "aria-hidden", "aria-modal"'));
check("Keyboard focus visibility helper exists", manager.includes("function keepKeyboardFocusVisible"));
check("Keyboard focus visibility uses nearest scrolling", manager.includes('scrollIntoView({ block: "nearest", inline: "nearest" })'));
check("Focus visibility listener is capture-phase", manager.includes('addEventListener("focusin", keepKeyboardFocusVisible, true)'));
check("Focus visibility listener is cleaned up", manager.includes('removeEventListener("focusin", keepKeyboardFocusVisible, true)'));

const phaseCss = accessibilityCss.slice(accessibilityCss.indexOf("/* Phase 14:"));
check("Phase 14 CSS marker exists", phaseCss.startsWith("/* Phase 14:"));
check("Routine semantic target floor is 24px", phaseCss.includes('min-block-size: 24px') && phaseCss.includes('min-inline-size: 24px'));
check("Button/summary touch input avoids delayed gesture behavior", phaseCss.includes("touch-action: manipulation"));
check("Form controls inherit application typography", phaseCss.includes(':where(input, textarea, select) { font: inherit; }'));
check("Larger text collapses master-detail layout", phaseCss.includes(':root[data-text-scale="larger"]') && phaseCss.includes(".cluster-master-detail-v429"));
check("Largest text collapses settings/admin split layouts", phaseCss.includes(".settings-layout-v178") && phaseCss.includes(".user-admin-layout-v244"));
check("Largest text releases sticky settings rails", phaseCss.includes("position: static") && phaseCss.includes(".settings-console-nav-v269"));
check("Phase 14 CSS adds no important override", !phaseCss.includes("!important"));
check("Phase 14 CSS adds no gradients", !phaseCss.includes("gradient("));
check("Phase 14 CSS adds no backdrop filter", !phaseCss.includes("backdrop-filter"));
check("Phase 14 CSS adds no raw hex colors", !/#[0-9a-fA-F]{3,8}\b/.test(phaseCss));

for (const [id, label] of [
  ["accessibility-motion", "Animation and motion"],
  ["accessibility-contrast", "Interface contrast"],
  ["accessibility-transparency", "Glass and transparency"],
  ["accessibility-text-scale", "Text size"],
  ["accessibility-density", "Interface density"],
  ["accessibility-focus-indicator", "Focus indicator"],
  ["accessibility-status-palette", "Status color palette"],
]) {
  check(`Accessibility setting ${label} has explicit native association`, settings.includes(`htmlFor="${id}"`) && settings.includes(`id="${id}"`));
}

check("Static gate blocks positive tabIndex", staticAudit.includes("positive tabIndex is prohibited"));
check("Static gate blocks zoom-disabled viewport", staticAudit.includes("Web viewport must not disable browser zoom"));
check("Static gate requires keyboard focus visibility infrastructure", staticAudit.includes("Keyboard focus visibility guard is missing"));
check("Web viewport does not disable zoom", !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[.,]0*)?/i.test(webIndex));
check("Runtime CI retains skip-link check", runtimeCi.includes("Skip link reaches main content"));
check("Runtime CI retains modal focus restoration", runtimeCi.includes("Command palette traps and restores focus"));
check("Runtime CI checks keyboard focus visibility", runtimeCi.includes("Keyboard focus remains visible while tabbing"));
check("Runtime CI checks enlarged-text reflow", runtimeCi.includes("Largest Cluster text scale reflows without page-level horizontal overflow"));
check("Runtime CI audits Settings", runtimeCi.includes('auditSurface(page, "Settings"'));
check("Runtime CI still blocks serious/critical/contrast violations", runtimeCi.includes("critical/serious axe violations and color-contrast violations"));

check("Desktop preferences read Qt accessibility hints", desktopPrefs.includes("QAccessibilityHints") && desktopPrefs.includes("contrastPreferenceChanged"));
check("Desktop preferences retain OS reduced-motion handling", desktopPrefs.includes("SPI_GETCLIENTAREAANIMATION"));
check("Desktop preferences retain OS transparency handling", desktopPrefs.includes("EnableTransparency"));

check("Phase 14 docs prohibit positive tabindex", docs.includes("positive `tabIndex` is prohibited"));
check("Phase 14 docs define editable shortcut boundary", docs.includes("must not hijack editable controls"));
check("Phase 14 docs define target floors", docs.includes("24px minimum target floor") && docs.includes("44px") && docs.includes("48px"));
check("Phase 14 docs preserve browser zoom", docs.includes("must not disable browser zoom"));
check("Phase 14 docs define manual review boundary", docs.includes("Manual release review") && docs.includes("screen-reader"));
check("Phase 14 docs state non-certification boundary", docs.includes("not a claim of legal or third-party accessibility certification"));

const pkg = JSON.parse(pkgText);
check("Aggregate audit includes Phase 14 gate", String(pkg.scripts?.audit || "").includes("accessibility-input-phase14-audit.mjs"));
check("Named Phase 14 audit exists", String(pkg.scripts?.["audit:accessibility-input-phase14"] || "").includes("accessibility-input-phase14-audit.mjs"));
check("Master packager invokes Phase 14 gate", packager.includes("accessibility-input-phase14-audit.mjs"));
check("Master/source packages carry Phase 14 docs", packager.split("docs/ACCESSIBILITY_INPUT_PHASE14.md").length - 1 >= 2);
check("Phase 14 notes identify capability and API contract", notes.includes("accessibility-input-phase14-v1") && notes.includes("2026-08-02.63"));
check("Changelog includes v0.437.0", changelog.includes('version: "v0.437.0"') && changelog.includes("Accessibility and input audit"));

console.log(`\nAccessibility & input Phase 14 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
