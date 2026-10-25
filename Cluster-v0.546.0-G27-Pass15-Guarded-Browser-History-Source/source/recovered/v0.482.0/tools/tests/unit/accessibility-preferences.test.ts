import assert from "node:assert/strict";
import { accessibilityPreferenceDefaults, resolveAccessibilityPreferences } from "../../../packages/renderer/src/core/accessibility-preferences";

const none = { reducedMotion: false, highContrast: false, reducedTransparency: false };
const systemA11y = { reducedMotion: true, highContrast: true, reducedTransparency: true };

assert.equal(resolveAccessibilityPreferences({ userMotionPreference: "system" }, systemA11y).motion, "reduced", "system motion follows reduced-motion preference");
assert.equal(resolveAccessibilityPreferences({ userMotionPreference: "none" }, none).motion, "none", "explicit no-motion mode wins");
assert.equal(resolveAccessibilityPreferences({ userContrastPreference: "system" }, systemA11y).highContrast, true, "system contrast follows platform preference");
assert.equal(resolveAccessibilityPreferences({ userHighContrast: true }, none).contrastPreference, "high", "legacy high-contrast preference migrates safely");
assert.equal(resolveAccessibilityPreferences({ userTransparencyPreference: "system" }, systemA11y).transparency, "off", "system reduced-transparency disables glass");
assert.equal(resolveAccessibilityPreferences({ userReduceTransparency: true }, none).transparency, "off", "legacy reduced-transparency preference remains conservative");
assert.equal(resolveAccessibilityPreferences({ userTextScale: "largest" }, none).textScale, "largest", "150 percent text scale is preserved");
assert.equal(resolveAccessibilityPreferences({ userStatusPalette: "color-vision-safe" }, none).statusPalette, "color-vision-safe", "color-vision-safe palette is preserved");
assert.deepEqual(accessibilityPreferenceDefaults(), {
  userMotionPreference: "system",
  userContrastPreference: "system",
  userTransparencyPreference: "system",
  userFocusIndicator: "strong",
  userTextScale: "default",
  userLargeClickTargets: false,
  userStatusPalette: "default",
}, "reset defaults are system-aware and accessibility-only");

console.log("Accessibility preference tests passed (9 assertions).");
