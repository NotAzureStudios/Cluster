import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
test("v0.419 Phase H Desktop-Native Polish contract",()=>{ const pkg=JSON.parse(read("package.json")); const c=read("packages/shared/src/api-contracts.ts"); const a=read("tools/scripts/polish-enhancement-phase-h-audit.mjs"); assert.equal(pkg.version,"0.422.0"); assert.ok(c.includes('version: "2026-08-02.62"')); assert.ok(c.includes('"polish-enhancement-phase-h-v1"')); assert.ok(a.includes("tray quick navigation exists")); assert.ok(a.includes("drop receipt added")); });
