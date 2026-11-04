// v1.1 department identity contracts, safe to run without a database.
import assert from "node:assert/strict";
import fs from "node:fs";

const schema = fs.readFileSync("apps/server/prisma/schema.prisma", "utf8");
const migration = fs.readFileSync("apps/server/prisma/migrations/20261115000000_v11_department_visual_identity/migration.sql", "utf8");
const routes = fs.readFileSync("apps/server/src/domains/workforce/workforce-routes.ts", "utf8");
const directory = fs.readFileSync("apps/server/src/domains/departments/department-repository.ts", "utf8");
const directoryRoute = fs.readFileSync("apps/server/src/domains/departments/department-routes.ts", "utf8");
const editor = fs.readFileSync("packages/renderer/src/features/people/CompanyGraphPanel.tsx", "utf8");
const mark = fs.readFileSync("packages/renderer/src/components/DepartmentIdentityMark.tsx", "utf8");
const graph = fs.readFileSync("packages/renderer/src/features/people/company-graph.ts", "utf8");

const contracts = [
  [schema.includes("  iconId      String?"), "canonical department icon column"],
  [migration.includes('ALTER TABLE "Department" ADD COLUMN "iconId" TEXT'), "migration adds persisted icon"],
  [routes.includes("const departmentIconSchema = z.enum(["), "department icons restricted to curated catalog"],
  [routes.includes("color: departmentColorSchema,") && routes.includes("iconId: departmentIconSchema"), "writes validate color and icon"],
  [routes.includes("...(body.iconId !== undefined ? { iconId: body.iconId } : {})"), "updates persist icon"],
  [routes.includes("...(body.color !== undefined ? { color: body.color } : {})"), "updates persist color"],
  [routes.includes("DEPARTMENT_REVISION_CONFLICT") && routes.includes("acquireTransactionAdvisoryLock"), "existing revision and hierarchy guards retained"],
  [routes.includes("iconId: row.iconId || null") && routes.includes("iconId: row.department.iconId || null"), "workforce and employment reads publish identity"],
  [directory.includes("async list(workspaceId: string)") && directory.includes("where: { workspaceId, archived: false }"), "directory scoped to workspace"],
  [directoryRoute.includes("service.list(membership.workspaceId)"), "directory scoped to requesting member"],
  [directory.includes("iconId: row.iconId || null"), "directory includes canonical icon"],
  [editor.includes("<ResourceIconPicker") && editor.includes('aria-label="Department color"'), "department editor changes identity"],
  [editor.includes("expectedRevision: department.revision || 1"), "UI maintains optimistic concurrency"],
  [graph.includes("iconId?: string | null"), "company graph supports persisted icons"],
  [mark.includes('department.iconId || "glyph:users"') && mark.includes("department.color"), "shared visual component uses persisted identity"],
  [!mark.includes("fetch(") && !mark.includes("queryApi("), "visual mark performs no per-row network requests"],
];
for (const [ok, name] of contracts) assert.ok(ok, name);
console.log(`v1.1 department identity: ${contracts.length} source contracts passed.`);
