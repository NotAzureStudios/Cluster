import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEVICE_PERFORMANCE_STORAGE_KEY,
  DEFAULT_DEVICE_PERFORMANCE_PREFERENCES,
  normalizeDevicePerformancePreferences,
  readDevicePerformancePreferences,
  resolveDeviceRendererQuality,
  writeDevicePerformancePreferences,
} from "../../packages/renderer/src/core/device-performance.ts";

const safe = { reducedTransparency: false, forcedColors: false, backdropFilter: true };
const reducedTransparency = { ...safe, reducedTransparency: true };
const forcedColors = { ...safe, forcedColors: true };
const noBackdrop = { ...safe, backdropFilter: false };

assert.deepEqual(normalizeDevicePerformancePreferences(null), DEFAULT_DEVICE_PERFORMANCE_PREFERENCES);
assert.deepEqual(normalizeDevicePerformancePreferences({ profile: "nope", customQuality: "__proto__" }), DEFAULT_DEVICE_PERFORMANCE_PREFERENCES);
assert.equal(resolveDeviceRendererQuality("full", safe, { profile: "efficient", customQuality: "full" }), "reduced");
assert.equal(resolveDeviceRendererQuality("full", safe, { profile: "performance", customQuality: "full" }), "reduced");
assert.equal(resolveDeviceRendererQuality("full", safe, { profile: "balanced", customQuality: "full" }), "balanced");
assert.equal(resolveDeviceRendererQuality("full", safe, { profile: "custom", customQuality: "reduced" }), "reduced");
assert.equal(resolveDeviceRendererQuality("full", safe, DEFAULT_DEVICE_PERFORMANCE_PREFERENCES), "full");
for (const guarded of [reducedTransparency, forcedColors, noBackdrop]) {
  assert.equal(resolveDeviceRendererQuality("full", guarded, { profile: "performance", customQuality: "full" }), "reduced");
}

const values = new Map();
let dispatches = 0;
globalThis.window = {
  localStorage: {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  },
  dispatchEvent() { dispatches++; },
};
assert.equal(writeDevicePerformancePreferences({ profile: "efficient", customQuality: "full" }), true);
assert.deepEqual(readDevicePerformancePreferences(), { profile: "efficient", customQuality: "full" });
assert.equal(dispatches, 1);
assert.equal(JSON.parse(values.get(DEVICE_PERFORMANCE_STORAGE_KEY)).profile, "efficient");
values.set(DEVICE_PERFORMANCE_STORAGE_KEY, "{broken JSON");
assert.deepEqual(readDevicePerformancePreferences(), DEFAULT_DEVICE_PERFORMANCE_PREFERENCES);
globalThis.window.localStorage.setItem = () => { throw new Error("storage denied"); };
assert.equal(writeDevicePerformancePreferences({ profile: "performance", customQuality: "full" }), false);
assert.equal(dispatches, 1);

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
assert.match(read("packages/renderer/src/core/render-capabilities.ts"), /resolveDeviceRendererQuality\(chooseQualityTier\(base\), base\)/);
assert.match(read("packages/renderer/src/features/settings/account-settings-registry.ts"), /key: "performance"/);
assert.match(read("packages/renderer/src/features/settings/AccountSettingsPage.tsx"), /<DevicePerformanceSettingsSection \/>/);
assert.match(read("packages/renderer/src/features/settings/account-settings-search.ts"), /section: "performance"/);
const stylesheet = read("packages/renderer/src/styles.css");
const performanceCss = read("packages/renderer/src/styles/renderer-performance.css");
const renderer = read("packages/renderer/src/core/render-capabilities.ts");
const scroll = read("packages/renderer/src/core/perceived-performance.ts");
const table = read("packages/renderer/src/components/ClusterDataTable.tsx");
const telemetry = read("packages/renderer/src/core/performance.ts");
const settings = read("packages/renderer/src/features/settings/AccountSettingsPage.tsx");

assert.match(stylesheet, /@import "\.\/styles\/renderer-performance\.css";/);
assert.match(performanceCss, /data-renderer-quality="reduced"/);
assert.match(performanceCss, /backdrop-filter: none !important;/);
assert.match(performanceCss, /data-device-performance-profile="efficient"/);
assert.match(renderer, /cachedWebGl2 !== null/);
assert.match(renderer, /dataset\.devicePerformanceProfile/);
assert.match(renderer, /resizeFrame = window\.requestAnimationFrame/);
assert.match(scroll, /persistenceTimerRef\.current = window\.setTimeout/);
assert.match(scroll, /setScrollTop\(latestScrollTop\.current\)/);
assert.match(table, /const renderedColumns = useMemo\(/);
assert.match(table, /selectable \? sortedRows\.map\(stableRowKey\) : \[\]/);
assert.match(telemetry, /recentMetrics = metrics\.filter/);
assert.match(settings, /section === "performance" && !dirty/);

console.log("Cluster performance settings: device policy, rendering, scrolling, table and telemetry assertions passed.");
