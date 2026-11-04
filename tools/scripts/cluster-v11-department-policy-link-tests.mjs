import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateStudioDepartmentPolicyLinks, DepartmentPolicyLinkError } from "../../apps/server/src/domains/departments/department-policy-link.ts";

let count=0;
async function check(label,cb){await cb();count++;console.log("PASS",label);}
function store({ workspaceId="studio-1", departmentIds=["dept-1","dept-2"] }={}) {
  const calls=[];
  return {calls,prisma:{
    workspaceMember:{async findFirst(query){calls.push(["membership",query]);return workspaceId ? {workspaceId} : null;}},
    department:{async findMany(query){calls.push(["department",query]);return departmentIds.filter(id=>query.where.id.in.includes(id)).map(id=>({id}));}},
  }};
}
const link=(id)=>({id:"policy-"+id,workforceDepartmentId:id});
const valid=async(db,defs)=>validateStudioDepartmentPolicyLinks(db,"owner-1",defs);
const invalid=(code="DEPARTMENT_POLICY_LINK_INVALID")=>(err)=>err instanceof DepartmentPolicyLinkError&&err.code===code&&err.statusCode===400;
await check("Unlinked templates need no workforce access",async()=>{
  const {prisma,calls}=store();
  assert.deepEqual(await valid(prisma,[{id:"studio",workforceDepartmentId:null},{id:"global"}]),[]);
  assert.equal(calls.length,0);
});
await check("Linked active departments validated within actor workspace",async()=>{
  const {prisma,calls}=store();
  assert.deepEqual(await valid(prisma,[link("dept-1"),link("dept-2")]),["dept-1","dept-2"]);
  assert.equal(calls[0][1].where.userId,"owner-1");
  assert.equal(calls[1][1].where.workspaceId,"studio-1");
  assert.equal(calls[1][1].where.archived,false);
  assert.deepEqual(calls[1][1].where.id.in,["dept-1","dept-2"]);
});
await check("Duplicate IDs rejected before database read",async()=>{
  const {prisma,calls}=store();
  await assert.rejects(valid(prisma,[link("dept-1"),link("dept-1")]),invalid());
  assert.equal(calls.length,0);
});
await check("Malformed or whitespace-only reference rejected",async()=>{
  const {prisma}=store();
  for(const value of [""," "," dept-1","dept-1 ",true,123,{}, "x".repeat(129)]){
    await assert.rejects(valid(prisma,[{id:"policy",workforceDepartmentId:value}]),invalid());
  }
});
await check("No actor workspace prevents cross-workspace lookup",async()=>{
  const {prisma,calls}=store({workspaceId:null});
  await assert.rejects(valid(prisma,[link("dept-1")]),invalid());
  assert.equal(calls.length,1);
});
await check("Missing or archived or foreign-workspace department rejected",async()=>{
  const {prisma}=store({departmentIds:["dept-1"]});
  await assert.rejects(valid(prisma,[link("dept-1"),link("foreign")]),invalid());
});
await check("Bounded arrays and object-shaped entries enforced",async()=>{
  const {prisma}=store();
  for(const value of [null,{},new Array(257).fill({id:"template"}),[null],["template"]]) {
    await assert.rejects(valid(prisma,value),invalid());
  }
});
const server=readFileSync("apps/server/src/app/server-routes-configuration-integrations.ts","utf8");
const types=readFileSync("packages/renderer/src/features/application/application-models/settings-server.ts","utf8");
const ui=readFileSync("packages/renderer/src/features/settings/StudioSettingsPage.tsx","utf8");
await check("Protected Studio settings write invokes authoritative validator",()=>{
  const put=server.slice(server.indexOf('app.put("/api/settings"'),server.indexOf('app.get("/api/security/diagnostics"'));
  assert.ok(put.includes("await validateStudioDepartmentPolicyLinks(prisma, admin.id, safeBody.studioDepartmentDefinitions)"));
  assert.ok(put.includes('code: "DEPARTMENT_POLICY_LINK_INVALID"'));
  assert.ok(put.includes("await verifyUserPin(admin, body.securityPin"));
  assert.ok(put.includes("await patchSettings(safeBody, expectedSettings)"));
});
await check("Studio department templates store immutable link metadata",()=>{
  assert.ok(types.includes("workforceDepartmentId?: string | null"));
  assert.ok(ui.includes('label>Linked Workforce Department</label>'));
  assert.ok(ui.includes('workforceDepartmentId: event.target.value || null'));
  assert.ok(ui.includes("studioDepartments.some((template) => template.id !== selectedDepartment.id && template.workforceDepartmentId === department.id)"));
});
await check("Linked policy displays actual workforce department icon/color without per-row requests",()=>{
  assert.ok(ui.includes("<DepartmentIdentityMark department={workforceDepartmentById.get(department.workforceDepartmentId || \"\")!}"));
  const manager=readFileSync("packages/renderer/src/features/settings/WorkforceDepartmentManager.tsx","utf8");
  assert.ok(manager.includes('queryApi<DepartmentRow[]>("/api/departments"'));
  assert.ok(manager.includes("onRowsLoaded?.(result)"));
  assert.ok(ui.includes("onRowsLoaded={setWorkforceDepartmentRows}"));
  assert.ok(ui.includes("key={currentUser.id}"));
  assert.ok(ui.includes("setWorkforceDepartmentRows([])"));
  assert.ok(!ui.includes('"/api/departments", { force: true, staleMs: 0'));
  assert.ok(ui.includes("const workforceDepartmentById = useMemo("));
});
console.log(`v1.1 department policy link: ${count} runtime and source contracts passed.`);
