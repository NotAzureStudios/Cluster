import assert from "node:assert/strict";
import { accessibleDocumentTitle, keyboardNudge, nextEnabledIndex } from "../../../packages/renderer/src/core/accessibility";

assert.equal(nextEnabledIndex([false, true, false], 0, 1), 2, "listbox navigation skips disabled options");
assert.equal(nextEnabledIndex([false, true, false], 2, 1), 0, "listbox navigation wraps forward");
assert.equal(nextEnabledIndex([false, true, false], 0, -1), 2, "listbox navigation wraps backward");
assert.deepEqual(keyboardNudge("ArrowLeft", false), { dx: -1, dy: 0 }, "whiteboard fine nudge uses one pixel");
assert.deepEqual(keyboardNudge("ArrowDown", true), { dx: 0, dy: 10 }, "whiteboard coarse nudge uses ten pixels");
assert.equal(keyboardNudge("Enter", false), null, "non-arrow keys do not move canvas objects");
assert.equal(accessibleDocumentTitle("Projects"), "Projects · Cluster", "route title identifies the current workspace");

console.log("Accessibility core tests passed (7 assertions).");
