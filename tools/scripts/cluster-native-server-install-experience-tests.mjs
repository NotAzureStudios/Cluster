import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(path, "utf8");
const ui = read("apps/server-launcher-go/launcher_ui_windows.go");
const prefs = read("apps/server-launcher-go/server_config_windows.go");
const installer = read("tools/installer/Install-Cluster.ps1");
const owner = read("apps/server/src/app/server-routes-setup.ts");
const wizard = read("packages/renderer/src/features/application/modules/ApplicationSetupWizard.tsx");
let passed = 0;
function check(label, test) { test(); passed++; console.log("PASS " + label); }

check("Performance dashboard defaults on but respects saved hidden preference", () => {
  assert.match(prefs, /PerformanceView\s+\*bool\s+\x60json:"performanceView,omitempty"\x60/);
  assert.match(prefs, /return prefs\.PerformanceView == nil \|\| \*prefs\.PerformanceView/);
  assert.match(ui, /performanceVisible: nativePerformanceEnabled\(prefs\)/);
  assert.match(ui, /prefs\.PerformanceView = &visible/);
});
check("Win32 performance meters exist and have dedicated layout", () => {
  assert.match(ui, /InitCommonControlsEx/);
  assert.match(ui, /createControl\("msctls_progress32"/);
  assert.match(ui, /pbmSetBarColor/);
  assert.match(ui, /moveWindow\(ui\.perfService/);
  assert.match(ui, /moveWindow\(ui\.perfPorts/);
  assert.match(ui, /moveWindow\(ui\.performance,/);
  assert.match(ui, /for _, handle := range performanceLabels \{ procShowWindow\.Call\(handle, swShow\) \}/);
});
check("CPU RAM and disk indicators are populated", () => {
  assert.match(ui, /setWindowText\(ui\.perfCPU/);
  assert.match(ui, /setWindowText\(ui\.perfRAM/);
  assert.match(ui, /setWindowText\(ui\.perfDisk/);
  for (const name of ["perfCPUBar","perfRAMBar","perfDiskBar"]) {
    assert.ok(ui.includes("procSendMessageW.Call(ui."+name+", pbmSetPos"));
  }
});
check("Existing five and thirty second sampling budgets are unchanged", () => {
  assert.match(ui, /time\.Since\(ui\.lastResourceAt\) >= 5\*time\.Second/);
  assert.match(ui, /time\.Since\(ui\.lastPortsAt\) >= 5\*time\.Second/);
  assert.match(read("apps/server-launcher-go/gpu_metrics_windows.go"), /time\.Since\(sampler\.last\) < 30\*time\.Second/);
});
check("Installer preflight happens before expensive toolchain provisioning", () => {
  assert.match(installer, /function AssertInstallPreflight\(\)/);
  assert.match(installer, /\[IO\.DriveInfo\]::new\(\$root\)/);
  assert.match(installer, /if \(\$drive\.AvailableFreeSpace -lt \$minimum\)/);
  assert.match(installer, /'\.cluster-write-test-'/);
  assert.match(installer, /AssertServerStopped \$target/);
  assert.ok(installer.indexOf("  TestManifest $source") < installer.indexOf("  AssertInstallPreflight"));
  assert.ok(installer.indexOf("  AssertInstallPreflight") < installer.indexOf("  ProvisionPortableTools"));
  assert.match(installer, /if \(\$CheckOnly\) \{ Say 'Source archive verified; no installation or build was performed\.'; exit 0 \}/);
});
check("Installer shows honest phases and retains source-build release warning", () => {
  for (let i=1;i<=6;i++) assert.ok(installer.includes("'["+i+"/6]"),"missing phase "+i);
  assert.match(installer, /package-lock\.json is missing/);
  assert.match(installer, /ApplyRevision \$source \$hash/);
  assert.match(installer, /existing Cluster installation was not replaced/);
});
check("Only local first-run Owner is given privileged password exception", () => {
  assert.match(owner, /!existingComplete && !isLoopbackAddress\(request\.ip\)/);
  assert.match(owner, /ownerPassword: z\.string\(\)\.min\(PRIVILEGED_PASSWORD_MIN_LENGTH\)/);
  assert.match(owner, /validateNewPassword\(body\.ownerPassword,[^\n]+allowPrivilegedShortPassword: true \}/);
  assert.match(wizard, /Owner passwords may be 1–1024 characters/);
  assert.match(read("apps/server/src/core/auth.ts"), /export const PASSWORD_MIN_LENGTH = 12/);
});
console.log(passed + "/" + passed + " native Server dashboard, installer and Owner setup checks passed");
