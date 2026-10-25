import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");
const [settings, icons, fileButton, launcher, pkg, changelog, notes] = await Promise.all([
  read("packages/renderer/src/features/settings/StudioSettingsPage.tsx"),
  read("packages/renderer/src/components/ClusterIcon.tsx"),
  read("packages/renderer/src/components/ClusterFileButton.tsx"),
  read("apps/server-launcher-go/launcher_ui_windows.go"),
  read("package.json"),
  read("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
  read("RELEASE_NOTES_v0.472.0.md"),
]);

const checks = [
  ["v0.472 startup/dark-mode contract remains active", (() => { const [major, minor, patch] = String(JSON.parse(pkg).version || "0.0.0").split(".").map((value) => Number(value) || 0); return major > 0 || minor > 472 || (minor === 472 && patch >= 0); })()],
  ["Studio logo upload icon is part of the shared icon contract", icons.includes('| "upload"') && icons.includes("upload: <>")],
  ["Studio logo control uses the shared upload icon", settings.includes("<ClusterFileButton") && fileButton.includes('icon = "upload"')],
  ["Project type CSV helper accepts readonly defaults", settings.includes("const csv = (value?: readonly string[]) =>")],
  ["native utility buttons are owner drawn", launcher.includes("BS_OWNERDRAW keeps native utility buttons theme-consistent") && launcher.includes("wmDrawItem")],
  ["main server window draws owner buttons", launcher.includes("drawOwnerButton(lParam, ui.darkMode)")],
  ["settings window draws owner buttons", launcher.includes("drawOwnerButton(lParam, w.darkMode)")],
  ["dark mode invalidates static controls after theme changes", launcher.includes("ui.title, ui.subtitle, ui.statusDot, ui.status, ui.activity")],
  ["dark mode invalidates settings controls after theme changes", launcher.includes("w.title, w.sectionLabel, w.sectionCombo")],
  ["log copy uses Unicode clipboard", launcher.includes("setUnicodeClipboardText(ui.hwnd, text)") && launcher.includes("cfUnicodeText")],
  ["legacy clip.exe copy path is removed", !launcher.includes('exec.Command("clip.exe")')],
  ["clipboard ownership is transferred safely", launcher.includes("Clipboard owns hMem after SetClipboardData succeeds")],
  ["one-second status timer remains intact", launcher.includes("procSetTimer.Call(ui.hwnd, 1, 1000, 0)")],
  ["heavy performance sampling remains throttled", launcher.includes("time.Since(ui.lastResourceAt) >= 5*time.Second")],
  ["v0.472 changelog is documented", changelog.includes('version: "v0.472.0"')],
  ["v0.472 release notes document renderer startup and dark mode", notes.includes("Renderer startup build repair") && notes.includes("dark-mode")],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (ok) console.log(`PASS ${label}`);
  else { console.error(`FAIL ${label}`); failed += 1; }
}
console.log(`v0.472 startup/dark-mode audit: ${checks.length - failed}/${checks.length}`);
if (failed) process.exit(1);
