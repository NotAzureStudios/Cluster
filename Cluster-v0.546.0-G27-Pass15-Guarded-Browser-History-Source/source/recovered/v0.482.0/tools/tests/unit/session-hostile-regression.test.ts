import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationRuntime } from "../../../apps/server/src/core/collaboration-runtime.js";
import { createSessionService } from "../../../apps/server/src/domains/sessions/session-service.js";
import { sessionControlAction, shouldInvalidateAuthenticatedClientForError } from "../../../packages/renderer/src/core/session-lifecycle.js";

class FakeRaw {
  destroyed = false;
  writableEnded = false;
  writes: string[] = [];
  write(value: string) { this.writes.push(String(value)); return true; }
  end() { this.writableEnded = true; }
}

test("AUTH_REQUIRED invalidates protected client state but not public/auth endpoints", () => {
  assert.equal(shouldInvalidateAuthenticatedClientForError({ status: 401, code: "AUTH_REQUIRED", path: "/api/projects/project-1" }), true);
  assert.equal(shouldInvalidateAuthenticatedClientForError({ status: 401, code: "AUTH_REQUIRED", path: "/api/auth/login" }), false);
  assert.equal(shouldInvalidateAuthenticatedClientForError({ status: 401, code: "AUTH_REQUIRED", path: "/api/public/share/token" }), false);
  assert.equal(shouldInvalidateAuthenticatedClientForError({ status: 403, code: "ACCESS_DENIED", path: "/api/projects/project-1" }), false);
});

test("realtime session control distinguishes revocation from rotation", () => {
  assert.equal(sessionControlAction({ state: "revoked", reason: "logout" }), "invalidate");
  assert.equal(sessionControlAction({ state: "rotated", reason: "reauthenticated" }), "reconnect");
  assert.equal(sessionControlAction({ state: "unknown" }), "ignore");
});

test("collaboration streams are disconnected by exact revoked session", () => {
  const runtime = new CollaborationRuntime({ broadcastDelayMs: 1 });
  const first = new FakeRaw();
  const second = new FakeRaw();
  runtime.upsertPresence({ userId: "user-1", userName: "User", clientId: "client-a", tool: "board", resourceId: "board-1", updatedAt: Date.now() });
  runtime.upsertPresence({ userId: "user-1", userName: "User", clientId: "client-b", tool: "board", resourceId: "board-1", updatedAt: Date.now() });
  runtime.addStream("board", "board-1", { id: "stream-a", userId: "user-1", sessionId: "session-a", clientId: "client-a", raw: first as any, connectedAt: Date.now(), lastSentAt: Date.now() });
  runtime.addStream("board", "board-1", { id: "stream-b", userId: "user-1", sessionId: "session-b", clientId: "client-b", raw: second as any, connectedAt: Date.now(), lastSentAt: Date.now() });

  assert.equal(runtime.disconnectSession("session-a", "logout"), 1);
  assert.equal(first.writableEnded, true);
  assert.equal(second.writableEnded, false);
  assert.match(first.writes.join(""), /event: session/);
  assert.match(first.writes.join(""), /"state":"revoked"/);
  const state = runtime.stateFor("board", "board-1");
  assert.equal(state.presence.some((item) => item.clientId === "client-a"), false);
  assert.equal(state.presence.some((item) => item.clientId === "client-b"), true);
  runtime.close();
});

test("session rotation closes old realtime stream without treating it as logout", () => {
  const runtime = new CollaborationRuntime({ broadcastDelayMs: 1 });
  const raw = new FakeRaw();
  runtime.addStream("whiteboard", "whiteboard-1", { id: "stream-1", userId: "user-1", sessionId: "session-old", clientId: "desktop", raw: raw as any, connectedAt: Date.now(), lastSentAt: Date.now() });
  runtime.disconnectSession("session-old", "reauthenticated");
  assert.match(raw.writes.join(""), /"state":"rotated"/);
  assert.match(raw.writes.join(""), /"reason":"reauthenticated"/);
  runtime.close();
});

test("session service publishes revocation callbacks for personal and revoke-others flows", async () => {
  const calls: string[] = [];
  const repository = {
    revoke: async (id: string, reason: string) => { calls.push(`repo:${id}:${reason}`); return {}; },
    revokeOthers: async (userId: string, currentId: string, reason: string) => { calls.push(`repo-others:${userId}:${currentId}:${reason}`); return { count: 2 }; },
    revokeUser: async () => ({ count: 0 }),
  } as any;
  const service = createSessionService(
    repository,
    async () => undefined,
    (sessionId, userId, reason) => calls.push(`session:${sessionId}:${userId}:${reason}`),
    (userId, reason, exceptSessionId) => calls.push(`user:${userId}:${reason}:${exceptSessionId || ""}`),
  );
  await service.revokePersonal({ id: "current", userId: "user-1" }, { id: "other", userId: "user-1" });
  await service.revokeOthers({ id: "current", userId: "user-1" });
  assert.deepEqual(calls, [
    "repo:other:user_revoked",
    "session:other:user-1:user_revoked",
    "repo-others:user-1:current:revoke_others",
    "user:user-1:revoke_others:current",
  ]);
});
