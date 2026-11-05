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
assert.equal(resolveDeviceRendererQuality("reduced", safe, { profile: "performance", customQuality: "reduced" }), "full");
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
console.log("Cluster performance settings: 17 policy and integration assertions passed.");
