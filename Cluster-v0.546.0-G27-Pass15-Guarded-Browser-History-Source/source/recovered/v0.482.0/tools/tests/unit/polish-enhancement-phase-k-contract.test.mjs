import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const text=(p)=>fs.readFileSync(path.join(root,p),"utf8");
test("Phase K final polish remains release-gated",()=>{
 const c=text("packages/shared/src/api-contracts.ts"), styles=text("packages/renderer/src/styles.css"), k=text("packages/renderer/src/styles/design-system/phase-k-polish.css"), boards=text("packages/renderer/src/features/boards/BoardWorkspacePage.tsx");
 assert.match(c,/2026-08-02\.62/); assert.match(c,/polish-enhancement-phase-k-v1/);
 assert.ok(styles.trimEnd().endsWith('@import "./styles/design-system/phase-k-polish.css";'));
 assert.match(k,/scrollbar-gutter: stable/); assert.match(k,/overflow-x: auto !important/); assert.match(k,/prefers-reduced-motion: reduce/);
 assert.match(boards,/aria-label="Close board tools"/); assert.doesNotMatch(boards,/result\.error \|\| "Unknown error"/);
});
