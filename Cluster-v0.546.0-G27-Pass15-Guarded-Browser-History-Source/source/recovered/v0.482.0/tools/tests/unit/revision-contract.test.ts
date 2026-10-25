import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");

test("collaborative records persist monotonic revisions", async () => {
  const schema = await readFile(path.join(root, "apps/server/prisma/schema.prisma"), "utf8");
  for (const model of ["Board", "BoardList", "Card", "Whiteboard"]) {
    const block = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1] || "";
    assert.match(block, /revision\s+Int\s+@default\(1\)/, `${model} must have a persisted revision`);
  }
});

test("board and whiteboard mutations enforce expected revisions and return conflicts", async () => {
  const source = await readFile(path.join(root, "apps/server/src/app/cluster-server.ts"), "utf8");
  assert.match(source, /code:\s*"revision_conflict"/);
  for (const route of ["/api/boards/:boardId", "/api/lists/:listId", "/api/cards/:cardId", "/api/cards/:cardId/move", "/api/whiteboards/:whiteboardId"]) {
    const start = source.indexOf(route);
    assert.notEqual(start, -1, `${route} must exist`);
    const excerpt = source.slice(start, start + 5000);
    assert.match(excerpt, /expectedRevision/);
    assert.match(excerpt, /revision:\s*\{\s*increment:\s*1\s*\}/);
  }
});
