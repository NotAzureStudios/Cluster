import assert from "node:assert/strict";
import test from "node:test";
import { collaborationMutationQueue, discardCollaborationMutation, queueCollaborationMutation, retryCollaborationMutation, sendOrQueueCollaborationMutation } from "../../../packages/renderer/src/features/collaboration/offlineQueue";

const values = new Map<string, string>();
const fakeWindow = {
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  },
  dispatchEvent: () => true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined
};

function installBrowser(online = true) {
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: { onLine: online }, configurable: true });
}

test.beforeEach(() => { values.clear(); installBrowser(true); });
test.afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { navigator?: unknown }).navigator;
});

test("queued PATCH mutations compact repeated edits to the same entity", () => {
  const first = queueCollaborationMutation({ tool: "board", resourceId: "board-1", path: "/api/cards/card-1", method: "PATCH", body: { title: "First" }, label: "Edit card", entityType: "card", entityId: "card-1" });
  const second = queueCollaborationMutation({ tool: "board", resourceId: "board-1", path: "/api/cards/card-1", method: "PATCH", body: { title: "Second" }, label: "Edit card", entityType: "card", entityId: "card-1" });
  const queue = collaborationMutationQueue("board", "board-1");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, second.id);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(queue[0].body, { title: "Second" });
});

test("conflict retry rebases the queued mutation onto the latest server revision", () => {
  const mutation = queueCollaborationMutation({ tool: "board", resourceId: "board-1", path: "/api/cards/card-1", method: "PATCH", body: { title: "Local title", expectedRevision: 2 }, label: "Edit card", entityType: "card", entityId: "card-1" });
  const key = "cluster-collaboration-offline-queue-v206";
  const queue = JSON.parse(fakeWindow.localStorage.getItem(key) || "[]");
  fakeWindow.localStorage.setItem(key, JSON.stringify(queue.map((item: Record<string, unknown>) => item.id === mutation.id ? { ...item, status: "conflict", conflictPayload: { current: { revision: 7 } } } : item)));
  retryCollaborationMutation(mutation.id);
  const retried = collaborationMutationQueue()[0];
  assert.equal(retried.status, "pending");
  assert.deepEqual(retried.body, { title: "Local title", expectedRevision: 7 });
});

test("offline collaboration mutations are retained for reconnect replay", async () => {
  installBrowser(false);
  const result = await sendOrQueueCollaborationMutation({ tool: "whiteboard", resourceId: "whiteboard-1", path: "/api/whiteboards/whiteboard-1", method: "PATCH", body: { expectedRevision: 4 }, label: "Save whiteboard", entityType: "whiteboard", entityId: "whiteboard-1" });
  assert.equal(result.queued, true);
  assert.equal(collaborationMutationQueue("whiteboard", "whiteboard-1").length, 1);
  if (result.mutation) discardCollaborationMutation(result.mutation.id);
  assert.equal(collaborationMutationQueue().length, 0);
});
