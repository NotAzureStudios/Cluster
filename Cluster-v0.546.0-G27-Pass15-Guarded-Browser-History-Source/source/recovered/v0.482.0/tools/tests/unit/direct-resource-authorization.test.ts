import assert from "node:assert/strict";
import test from "node:test";
import { createRequestAuthorizationBoundary } from "../../../apps/server/src/domains/access/request-authorization-boundary.js";

function request(url: string, method: string, params: Record<string, string> = {}) {
  return { url, method, params } as any;
}

function reply() {
  const state: any = { status: 200, body: null };
  return {
    state,
    code(value: number) { state.status = value; return this; },
    send(value: unknown) { state.body = value; return this; },
  } as any;
}

function harness() {
  const calls: any[] = [];
  const project = { id: "project-secret", archived: false, source: "manual" };
  const prisma: any = {
    project: { findUnique: async ({ where }: any) => where.id === project.id ? project : null },
    board: { findUnique: async ({ where }: any) => where.id === "board-secret" ? { id: where.id, project } : null },
    checklistItem: { findUnique: async ({ where }: any) => where.id === "check-secret" ? { id: where.id, card: { id: "card-secret" } } : null },
    projectFile: { findUnique: async ({ where }: any) => where.id === "file-secret" ? { id: where.id, project } : null },
    videoAsset: { findUnique: async ({ where }: any) => where.id === "asset-secret" ? { id: where.id, project } : null },
    videoComment: { findUnique: async ({ where }: any) => where.id === "comment-secret" ? { id: where.id, videoAsset: { id: "asset-secret", project } } : null },
    whiteboard: { findUnique: async ({ where }: any) => where.id === "whiteboard-secret" ? { id: where.id, project } : null },
    knowledgeItem: { findUnique: async ({ where }: any) => where.id === "knowledge-secret" ? { id: where.id, project } : null },
    calendarEvent: { findUnique: async ({ where }: any) => where.id === "calendar-secret" ? { id: where.id, project: null, ownerId: "owner-other" } : null },
    timelineItem: { findUnique: async ({ where }: any) => where.id === "timeline-secret" ? { id: where.id, project, userId: null } : null },
    timeEntry: { findUnique: async ({ where }: any) => where.id === "time-secret" ? { id: where.id, userId: "owner-other", project } : null },
    scheduleBlock: { findUnique: async ({ where }: any) => where.id === "schedule-secret" ? { id: where.id, userId: "owner-other", project } : null },
  };
  const authorization: any = {
    requireAdmin: async (...args: any[]) => { calls.push(["admin", ...args]); return true; },
    requireTool: async (_req: any, _rep: any, tool: string, level: string) => { calls.push(["tool", tool, level]); return true; },
    requireProject: async (_req: any, _rep: any, id: string, level: string) => { calls.push(["project", id, level]); return project; },
    requireTarget: async (_req: any, _rep: any, kind: string, id: string, parent: any, level: string) => { calls.push(["target", kind, id, parent?.id ?? null, level]); return true; },
    requireList: async (_req: any, _rep: any, id: string, level: string) => { calls.push(["list", id, level]); return true; },
    requireCard: async (_req: any, _rep: any, id: string, level: string) => { calls.push(["card", id, level]); return true; },
    requireUserScope: async (_req: any, _rep: any, requirement: any) => { calls.push(["user-scope", requirement]); return true; },
  };
  return { boundary: createRequestAuthorizationBoundary({ prisma, authorization }), calls };
}

test("direct project children resolve their authoritative parent before authorization", async () => {
  const { boundary, calls } = harness();
  assert.equal(await boundary(request("/api/project-files/file-secret/file", "GET", { fileId: "file-secret" }), reply()), true);
  assert.deepEqual(calls.filter((entry) => entry[0] === "target").at(-1), ["target", "file", "file-secret", "project-secret", "view"]);

  assert.equal(await boundary(request("/api/video-assets/asset-secret/file", "GET", { assetId: "asset-secret" }), reply()), true);
  assert.deepEqual(calls.filter((entry) => entry[0] === "target").at(-1), ["target", "video", "asset-secret", "project-secret", "view"]);

  assert.equal(await boundary(request("/api/whiteboards/whiteboard-secret", "PATCH", { whiteboardId: "whiteboard-secret" }), reply()), true);
  assert.deepEqual(calls.filter((entry) => entry[0] === "target").at(-1), ["target", "whiteboard", "whiteboard-secret", "project-secret", "contribute"]);
});

test("video comment IDs cannot bypass the owning video/project authorization boundary", async () => {
  const { boundary, calls } = harness();
  const result = await boundary(request("/api/video-comments/comment-secret", "PATCH", { commentId: "comment-secret" }), reply());
  assert.equal(result, true);
  assert.deepEqual(calls.filter((entry) => entry[0] === "target").at(-1), ["target", "video", "asset-secret", "project-secret", "contribute"]);
});

test("generic checklist aliases resolve through card authorization so ticket permissions still apply", async () => {
  const { boundary, calls } = harness();
  assert.equal(await boundary(request("/api/checklist/check-secret", "PATCH", { itemId: "check-secret" }), reply()), true);
  assert.deepEqual(calls.filter((entry) => entry[0] === "card").at(-1), ["card", "card-secret", "contribute"]);
});

test("user-scoped direct resources require owner/manager scope in addition to project scope", async () => {
  const { boundary, calls } = harness();
  assert.equal(await boundary(request("/api/time/entries/time-secret", "PUT", { entryId: "time-secret" }), reply()), true);
  const userScope = calls.find((entry) => entry[0] === "user-scope");
  assert.deepEqual(userScope?.[1], { ownerUserId: "owner-other", tool: "time", minimum: "edit" });
  assert.ok(calls.some((entry) => entry[0] === "target" && entry[1] === "time" && entry[2] === "time-secret"));
});

test("unknown direct object IDs fail closed before the handler runs", async () => {
  const { boundary } = harness();
  const rep = reply();
  const result = await boundary(request("/api/video-comments/not-real", "PATCH", { commentId: "not-real" }), rep);
  assert.equal(result, false);
  assert.equal(rep.state.status, 404);
  assert.equal(rep.state.body.code, "RESOURCE_NOT_FOUND");
});

test("admin route families are authorized before resource handlers", async () => {
  const { boundary, calls } = harness();
  assert.equal(await boundary(request("/api/admin/tools/files", "GET", { tool: "files" }), reply()), true);
  assert.ok(calls.some((entry) => entry[0] === "admin"));
});
