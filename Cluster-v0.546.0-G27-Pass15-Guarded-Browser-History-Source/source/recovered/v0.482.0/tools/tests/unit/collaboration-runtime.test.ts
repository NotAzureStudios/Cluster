import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationRuntime } from "../../../apps/server/src/core/collaboration-runtime";

test("collaboration runtime owns presence, action retention, access caching, and diagnostics", () => {
  const runtime = new CollaborationRuntime({ staleMs: 100, accessCacheMs: 100, retainedActions: 2, stateActionLimit: 2 });
  const now = Date.now();
  runtime.upsertPresence({
    userId: "user-1",
    userName: "Duckey",
    clientId: "browser",
    tool: "board",
    resourceId: "board-1",
    updatedAt: now
  });
  for (let index = 0; index < 3; index += 1) {
    runtime.recordAction({
      id: `action-${index}`,
      userId: "user-1",
      userName: "Duckey",
      tool: "board",
      resourceId: "board-1",
      action: "edit",
      createdAt: now + index
    });
  }
  runtime.setCachedAccess("user-1:board-1", true);

  assert.equal(runtime.getCachedAccess("user-1:board-1"), true);
  assert.equal(runtime.stateFor("board", "board-1").actions.length, 2);
  assert.equal(runtime.diagnostics().presenceSessions, 1);
  assert.equal(runtime.diagnostics().retainedActions, 2);

  runtime.trim(now + 101);
  assert.equal(runtime.diagnostics().presenceSessions, 0);
  runtime.close();
});
