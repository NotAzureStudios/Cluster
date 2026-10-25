import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let passed = 0;
const check = (condition, name) => { assert.ok(condition, name); passed++; console.log(`PASS ${name}`); };
const source = readFileSync('apps/server/src/domains/users/user-directory-routes.ts', 'utf8');
const createSection = source.slice(source.indexOf('app.post("/api/users"'), source.indexOf('app.patch("/api/users/:userId"'));
const createSnippet = createSection.slice(createSection.indexOf('const canonicalSaved: any = await prisma.$transaction'), createSection.indexOf('  const saved = canonicalSaved;'));
check(createSnippet.includes('await tx.user.create') && !createSnippet.includes('prisma.user.create'), 'identity creation is inside canonical transaction');
check(createSnippet.includes('await syncUserWorkforceAuthorities(tx') && createSnippet.includes('return tx.user.findUniqueOrThrow'), 'workforce synchronization and projection share transaction');
check(!createSection.includes('await prisma.workspaceMember.upsert('), 'creation does not re-write nested workspace membership after commit');
const patchSection = source.slice(source.indexOf('app.patch("/api/users/:userId"'), source.indexOf('app.get("/api/users/:userId/profile"'));
const patchTxn = patchSection.slice(patchSection.indexOf('updated = await prisma.$transaction'), patchSection.indexOf('  } catch (error)'));
check(patchTxn.includes('await tx.workspaceMember.upsert') && patchTxn.includes('await syncUserWorkforceAuthorities(tx'), 'role updates and People changes share the same transaction');
check(!patchSection.slice(patchSection.indexOf('  } catch (error)')).includes('await prisma.workspaceMember.upsert'), 'no post-commit workspace-role mutation remains');
// Execute the actual provisioning closure inside a transactional mock to check rollback.
const evaluated = ts.transpileModule(`module.exports = async function run(prisma, body, syncUserWorkforceAuthorities) {
  const username = 'engineer';
  const commonData = { displayName: 'Engineer' };
  const temporaryPasswordHash = 'hash';
  const workspace = { id: 'studio-1' };
  const WORKFORCE_USER_AUTHORITY_INCLUDE = {};
  const normalizeExpertise = (value) => value || [];
  ${createSnippet}
  return canonicalSaved;
}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { module: { exports: {} }, exports: {}, Promise };
vm.runInNewContext(evaluated, sandbox);
const run = sandbox.module.exports;
function mockStore() {
  const state = { committed: null, transactionCount: 0 };
  const prisma = { async $transaction(callback) {
    state.transactionCount++;
    let pending = null;
    const tx = { user: {
      async create(input) { pending = { id: 'u1', username: input.data.username, displayName: input.data.displayName, memberships: [{workspaceId: input.data.memberships.create.workspaceId, role: input.data.memberships.create.role}] }; return pending; },
      async findUniqueOrThrow() { assert.ok(pending); return {...pending, _count: { assignedCards: 0 }}; },
    } };
    const output = await callback(tx);
    state.committed = pending;
    return output;
  } };
  return { prisma, state };
}
const created = mockStore();
const result = await run(created.prisma, { role: 'member' }, async () => {});
check(result.username === 'engineer' && created.state.committed?.memberships[0].workspaceId === 'studio-1', 'successfully creates account and membership together');
check(created.state.transactionCount === 1, 'provisioning uses exactly one transaction');
const failed = mockStore();
await assert.rejects(run(failed.prisma, {role:'member'}, async ()=> {throw new Error('workforce failed');}), /workforce failed/);
check(failed.state.committed === null, 'workforce failure rolls back account creation');
const routes = readFileSync('apps/server/src/domains/access/access-routes.ts', 'utf8');
const explorer = readFileSync('packages/renderer/src/features/projects/ProjectAccessPanel.tsx', 'utf8');
check(routes.includes('const targetTool = authorization.targetTool(query.targetKind)') && routes.includes('result.tool = await authorization.authorize(subjectActor'), 'Access Explorer includes canonical target-tool explanation');
check(routes.includes('app.get("/api/access/explain", async (request, reply) => {\n    reply.header("Cache-Control", "private, no-store")'), 'person-scoped explanations are no-store on the server');
check(explorer.includes('await api<AccessExplainPayload>(`/api/access/explain?${params}`)') && !explorer.includes('queryApi<AccessExplainPayload>'), 'Access Explorer does not retain private explanations in query cache');
check(explorer.includes('Restricted or unavailable target') && !explorer.includes('const targetOptions = useMemo('), 'Project Access rule list does not project local unauthorized titles or identifiers');
for (const file of ['features/projects/ProjectOverviewDashboard.tsx', 'features/projects/ProjectControlCenterPanel.tsx', 'features/people/PeoplePages.tsx']) {
  const text = readFileSync(`packages/renderer/src/${file}`, 'utf8');
  check(text.includes('resolveClusterResourceActions('), `${file} uses canonical resource action adapter`);
}
const registry = readFileSync('packages/renderer/src/core/resource-action-registry.ts', 'utf8');
const module = { exports: {} };
const js = ts.transpileModule(registry, {compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 }}).outputText;
vm.runInNewContext(js,{module,exports:module.exports,require:()=>({CLUSTER_RESOURCE_MANIFEST:{user:{projectScoped:false},project:{projectScoped:false},board:{projectScoped:true}}}),Set});
const resolve = module.exports.resolveClusterResourceActions;
let invoked = 0;
const actions = [{id:'view', label:'View', resourceKinds:['user'], allowed:()=>true, onSelect:()=>{invoked++;}},{id:'admin',label:'Admin',resourceKinds:['user'],allowed:()=>false,onSelect:()=>{throw new Error('unauthorized');}}];
const items = resolve({kind:'user',id:'u1'},actions);
check(items.length===1, 'People registry hides denied resource actions');
items[0].onSelect();check(invoked===1,'canonical adapter executes domain-owned handler once');
check(resolve({kind:'board',id:'b1'},[{...actions[0],resourceKinds:['board']}]).length===0, 'project-scoped resource actions require project ID');
// Extract the *actual* profile transaction to exercise success, rollback and CAS.
const patchClosure = patchTxn.slice(patchTxn.indexOf('updated = await prisma.$transaction'));
const patchWrapped = ts.transpileModule(`module.exports = async function runPatch(prisma, body, options = {}) {
 const params = { userId: 'u1' };
 const profileDefinitions = [];
 const WORKFORCE_USER_AUTHORITY_INCLUDE = {};
 const lockPeopleProfile = async () => {};
 class PeopleGovernanceError extends Error {
   constructor(code, message, statusCode, details) { super(message); this.code=code; this.statusCode=statusCode; this.details=details; }
 }
 const validateManagerAssignment = async () => {};
 const normalizeAuthUsername = (value) => value;
 const normalizeExpertise = (value) => value;
 const validateCustomProfileFields = (value) => value;
 const parseProfileJsonRecord = (value) => value || {};
 const syncUserWorkforceAuthorities = async () => { if (options.failWorkforce) throw new Error('workforce rollback'); };
 let updated;
 ${patchClosure}
 return updated;
}`, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const patchModule={exports:{}};
vm.runInNewContext(patchWrapped,{module:patchModule,exports:patchModule.exports,Promise,Date,JSON});
const runPatch=patchModule.exports;
function patchMock(failRole=false){
 const store={user:{id:'u1',username:'initial',displayName:'Original',profileRevision:1,employment:{capacityHours:40,minimumHours:8}},role:'member',writes:0,commits:0};
 return {store,prisma:{$transaction:async (fn)=>{
   const pending={user:{...store.user,employment:{...store.user.employment}},role:store.role};
   const tx={
      user:{
       findUnique:async()=>pending.user,
       update:async({data})=>{pending.user={...pending.user,displayName:data.displayName ?? pending.user.displayName,profileRevision:pending.user.profileRevision+1};store.writes++;return pending.user;},
       findUniqueOrThrow:async()=>({...pending.user,memberships:[{role:pending.role}],_count:{assignedCards:0}}),
      },
      workspace:{findFirstOrThrow:async()=>({id:'ws1'})},
      workspaceMember:{findFirst:async()=>({workspaceId:'ws1'}),upsert:async({update})=>{if(failRole)throw new Error('role rollback');pending.role=update.role;}},
   };
   const result=await fn(tx);
   store.user=pending.user;store.role=pending.role;store.commits++;
   return result;
 }}};
}
const edited = patchMock();
const editResult=await runPatch(edited.prisma,{displayName:'Updated',role:'reviewer',expectedProfileRevision:1});
check(editResult.displayName==='Updated' && edited.store.role==='reviewer' && edited.store.user.profileRevision===2,'profile and role commit atomically');
check(edited.store.commits===1,'successful profile edit performs one transaction');
const editFailed=patchMock(true);
await assert.rejects(runPatch(editFailed.prisma,{displayName:'Changes',role:'admin',expectedProfileRevision:1}),/role rollback/);
check(editFailed.store.user.displayName==='Original' && editFailed.store.role==='member' && editFailed.store.commits===0,'failed role update cannot commit modified profile');
const workforceFailed=patchMock();
await assert.rejects(runPatch(workforceFailed.prisma,{displayName:'Changes',role:'admin'},{failWorkforce:true}),/workforce rollback/);
check(workforceFailed.store.user.profileRevision===1 && workforceFailed.store.commits===0,'failed workforce edit cannot advance profile revision');
const staleEdit=patchMock();
await assert.rejects(runPatch(staleEdit.prisma,{displayName:'Stale',role:'admin',expectedProfileRevision:3}),/This profile changed/);
check(staleEdit.store.writes===0 && staleEdit.store.commits===0,'stale profile revision is rejected before any modification');
// Admin-only endpoints are guarded by the central request policy before route execution.
const policyTs=readFileSync('apps/server/src/domains/access/request-policy.ts','utf8');
const policyModule={exports:{}};
vm.runInNewContext(ts.transpileModule(policyTs,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:policyModule,exports:policyModule.exports,Set});
const requestPolicy=policyModule.exports.describeClusterRequest;
check(requestPolicy('/api/users','POST').access.kind==='admin','central request boundary requires admin for People provisioning');
check(requestPolicy('/api/users/u1','PATCH').access.kind==='admin','central request boundary requires admin for privileged People profile and role edits');
check(requestPolicy('/api/users/u1/profile','GET').access.kind==='tool','ordinary People profile reads retain tool-level access');
console.log(`${passed}/${passed} v0.507 closeout and v0.508 People atomic provisioning assertions passed`);
