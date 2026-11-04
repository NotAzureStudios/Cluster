import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const source = readFileSync("apps/server/src/domains/users/people-governance.ts", "utf8")
  .replace('from "../../core/postgres-advisory-lock.js"', 'from "./stub-lock.ts"');
const folder = mkdtempSync(join(tmpdir(), "cluster-v11-manager-"));
let validateManagerAssignment;
try {
  writeFileSync(join(folder, "package.json"), '{"type":"module"}');
  writeFileSync(join(folder, "stub-lock.ts"), 'export async function acquireTransactionAdvisoryLock(tx,key){await tx.__lock(key);}');
  writeFileSync(join(folder, "people-governance.ts"), source);
  ({validateManagerAssignment} = await import(pathToFileURL(join(folder,"people-governance.ts")).href));
  let passed=0;
  const expectCode=(code)=>(err)=>err?.code===code;
  async function check(label, fn){await fn();passed++;console.log("PASS",label);}
  function fixture({managerId="leader",workspaceId="studio-1",managerWorkspace="studio-1",chain={}}={}) {
    const log=[];
    const tx={
      async __lock(key){log.push(["lock",key]);},
      user:{
        async findFirst(query) {
          log.push(["manager",query.where]);
          if(query.where.id!==managerId || managerWorkspace!==workspaceId || !managerId)return null;
          return {id:managerId,username:managerId,employment:{managerUserId:chain[managerId]||null}};
        },
        async findUnique(query) {
          const id=query.where.id;
          return chain[id] ? {id,employment:{managerUserId:chain[id]}} : {id,employment:{managerUserId:null}};
        },
      },
    };
    return {tx,log};
  }
  await check("Null manager clears safely",async()=>{
    const {tx,log}=fixture();
    assert.equal(await validateManagerAssignment(tx,"person",null,"studio-1"),null);
    assert.equal(log[0][1],"cluster-people-manager-graph");
  });
  await check("Self manager assignment rejected",async()=>{
    const {tx}=fixture();
    await assert.rejects(validateManagerAssignment(tx,"person","person","studio-1"),expectCode("MANAGER_SELF_REFERENCE"));
  });
  await check("Cross-workspace manager rejected",async()=>{
    const {tx,log}=fixture({managerWorkspace:"studio-2"});
    await assert.rejects(validateManagerAssignment(tx,"person","leader","studio-1"),expectCode("MANAGER_INVALID"));
    const where=log.find(row=>row[0]==="manager")[1];
    assert.deepEqual(where.memberships,{some:{workspaceId:"studio-1"}});
  });
  await check("Same-workspace manager accepted",async()=>{
    const {tx}=fixture();
    const person=await validateManagerAssignment(tx,"person","leader","studio-1");
    assert.equal(person.id,"leader");
  });
  await check("Manager cycles rejected",async()=>{
    const {tx}=fixture({chain:{leader:"person"}});
    await assert.rejects(validateManagerAssignment(tx,"person","leader","studio-1"),expectCode("MANAGER_CYCLE"));
  });
  const routes=readFileSync("apps/server/src/domains/users/user-directory-routes.ts","utf8");
  const editor=readFileSync("packages/renderer/src/features/people/PeopleUserEditor.tsx","utf8");
  const page=readFileSync("packages/renderer/src/features/people/PeoplePages.tsx","utf8");
  await check("Both provisioning and profile updates enforce workspace",()=>{
    assert.ok(routes.includes("memberships: { some: { workspaceId: workspace.id } }"));
    assert.ok(routes.includes("validateManagerAssignment(tx, params.userId, body.managerUserId, actorMembership.workspaceId)"));
  });
  await check("Editor sends selected manager ID via revision-controlled profile save",()=>{
    assert.ok(editor.includes('managerUserId: profile.managerUserId'));
    assert.ok(editor.includes('update("managerUserId", event.target.value)'));
    assert.ok(editor.includes('managerOptions.filter((entry) => entry.id !== person.id)'));
    assert.ok(editor.includes('expectedProfileRevision: person.profileRevision || 1'));
  });
  await check("Manager options come from existing scoped workforce context",()=>{
    assert.ok(page.includes('managerOptions={(workforceContext?.people || [])'));
    assert.ok(page.includes('candidate.employment?.active !== false'));
    assert.ok(!editor.includes('queryApi('));
  });
  console.log(`v1.1 manager assignment: ${passed} runtime and UI checks passed.`);
} finally {
  rmSync(folder,{recursive:true,force:true});
}
