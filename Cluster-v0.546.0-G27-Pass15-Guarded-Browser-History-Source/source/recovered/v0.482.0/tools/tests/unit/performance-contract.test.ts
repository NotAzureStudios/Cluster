import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");

test("server enables compressed JSON and text responses without replacing SSE semantics", async () => {
  const source = await readFile(path.join(root, "apps/server/src/app/cluster-server.ts"), "utf8");
  assert.match(source, /app\.register\(compress/);
  assert.match(source, /encodings:\s*\["br",\s*"gzip",\s*"deflate"\]/);
  assert.match(source, /text\\\//);
  assert.match(source, /text\/event-stream/);
});

test("workspace collections use the shared read cache", async () => {
  const source = await readFile(path.join(root, "packages/renderer/src/features/application/ClusterApplication.tsx"), "utf8");
  assert.match(source, /queryApi<Project\[]>\("\/api\/projects"/);
  assert.match(source, /queryApi<WhiteboardSummary\[]>\("\/api\/whiteboards"/);
  assert.match(source, /queryApi<AccessRule\[]>\("\/api\/access-rules"/);
  assert.match(source, /Promise\.allSettled/);
});

test("high traffic query paths have compound indexes", async () => {
  const schema = await readFile(path.join(root, "apps/server/prisma/schema.prisma"), "utf8");
  for (const index of [
    "@@index([workspaceId, archived, updatedAt])",
    "@@index([userId, revokedAt, expiresAt])",
    "@@index([projectId, createdAt])",
    "@@index([userId, createdAt])"
  ]) assert.ok(schema.includes(index), `Missing ${index}`);
});
