import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { requireClusterProjectRole } from '../../packages/shared/src/project-role-policy.ts';
import { discoverProjectAccessTargets } from '../../apps/server/src/domains/access/project-target-discovery.ts';

let passed = 0;
function check(value, name) { assert.ok(value, name); passed++; console.log(`PASS ${name}`); }
function makeDb(allBoards = []) {
  const reads = [];
  const tables = { board: allBoards, whiteboard: [], libraryItem: [], reviewAsset: [] };
  function match(row, where = {}) {
    if (where.AND && !where.AND.every((condition) => match(row, condition))) return false;
    if (where.OR && !where.OR.some((condition) => match(row, condition))) return false;
    for (const [key, expected] of Object.entries(where)) {
      if (key === 'AND' || key === 'OR') continue;
      if (expected && typeof expected === 'object') {
        if ('contains' in expected && !String(row[key] || '').toLowerCase().includes(expected.contains.toLowerCase())) return false;
        if ('gt' in expected && !(row[key] > expected.gt)) return false;
        if ('notIn' in expected && expected.notIn.includes(row[key])) return false;
      } else if (row[key] !== expected) return false;
    }
    return true;
  }
  const db = {};
  for (const [kind, items] of Object.entries(tables)) db[kind] = {
    async findMany(query) {
      reads.push({ kind, query });
      assert.ok(query.take <= 16, 'discovery only pulls bounded query batches');
      return items.filter((item) => match(item, query.where)).sort((a,b) => {
        const key = kind === 'board' || kind === 'whiteboard' ? 'name' : 'title';
        return a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }).slice(0, query.take);
    },
  };
  db.accessRule = { async findMany() { return []; } };
  return { db, reads };
}
const privateRows = Array.from({length:410}, (_, index) => ({ id: `private-${index}`, name: `A${String(index).padStart(4, '0')} Hidden Board`, projectId: 'p1', archived: false }));
const publicRows = Array.from({length:9}, (_, index) => ({ id: `public-${index}`, name: `Z${String(index).padStart(4, '0')} Public Board`, projectId: 'p1', archived: false }));
const unrelated = [{id:'not-this-project', name:'ZZ Other Workspace',projectId:'p2',archived:false}];
const {db, reads} = makeDb([...privateRows, ...publicRows, ...unrelated]);
const project = {id:'p1',name:'Artemis',workspaceId:'studio'};
const input = (updates={}) => ({
  prisma: db, authorization: { async authorize(_req, _action, target, options) {
    assert.equal(options.surface,'api');
    return {allowed: !String(target.targetId).startsWith('private-')};
  } },
  project, request: {id:'request-1'}, actorId:'user-1', cursorSecret:'non-default-encryption-secret',
  q:'', minimum:'view', limit:4, ruleSelect:{targetKind:true}, canAccessLibraryItem:async () => false,
  ...updates,
});
const first = await discoverProjectAccessTargets(input());
check(first.targets.map(row=>row.id).join(',') === 'p1' && !!first.nextCursor, 'first page returns only authorized project and an opaque continuation');
check(!Buffer.from(first.nextCursor,'base64url').toString('utf8').includes('private-'), 'encrypted cursor does not expose scanned denied IDs');
check(reads.filter(r=>r.kind==='board').reduce((sum,r)=>sum+r.query.take,0) <= 320, 'initial scan is bounded despite 410 denied entries');
let next = first.nextCursor, pages = 1;
const visible = [...first.targets];
while (next && pages < 20) {
  const page = await discoverProjectAccessTargets(input({cursor:next}));
  visible.push(...page.targets);
  next = page.nextCursor;
  pages++;
}
check(next === null, 'cursor traversal terminates');
check(visible.length === 10 && visible.filter(row=>row.kind==='board').length === 9, 'all visible rows beyond 300 denied candidates can be reached');
check(new Set(visible.map(row=>`${row.kind}:${row.id}`)).size === visible.length, 'pages never duplicate entries');
check(!JSON.stringify(visible).includes('private-') && !JSON.stringify(visible).includes('not-this-project'), 'denied and cross-project names/IDs never appear in results');
check(pages >= 3, 'large data requires multiple bounded continuation requests');
await assert.rejects(discoverProjectAccessTargets(input({ cursor:first.nextCursor?.slice(0,-2)+'xx' })),/INVALID_PICKER_CURSOR/);
check(true, 'tampered cursor fails closed');
for (const updates of [{actorId:'user-2'}, {q:'different'}, {minimum:'manage'}, {project:{...project,id:'p2'}}]) {
  await assert.rejects(discoverProjectAccessTargets(input({cursor:first.nextCursor,...updates})),/INVALID_PICKER_CURSOR/);
}
check(true, 'cursor binds actor, query, minimum permission and project');
const rejecting = makeDb([]).db;
rejecting.accessRule.findMany = async () => {throw new Error('ACL store unavailable')};
await assert.rejects(discoverProjectAccessTargets(input({prisma:rejecting})),/ACL store unavailable/);
check(true, 'rule-store failures stop the discovery request');

const membershipPath = 'apps/server/src/domains/projects/project-membership.ts';
const compiled = ts.transpileModule(readFileSync(membershipPath,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const membership = {exports:{}};
vm.runInNewContext(compiled,{module:membership,exports:membership.exports,require:()=>({requireClusterProjectRole})});
const { writeProjectMembershipsInTransaction } = membership.exports;
const route = readFileSync('apps/server/src/domains/projects/project-routes.ts','utf8');
check(route.includes('await prisma.$transaction(async (tx: any) => {') && route.includes('writeProjectMembershipsInTransaction(tx') && route.includes('throw new ProjectRevisionWriteConflict()'), 'Project CAS and membership replacement share one rollback boundary');
let original = [{userId:'old',roleKey:'lead',isLead:true,status:'active'}];
let header = 7;
const transact = async (callback, failOnUser) => {
  let shadow = structuredClone(original), shadowHeader = header;
  const tx = {
    project:{async updateMany({where}) {if(where.revision!==shadowHeader) return {count:0};shadowHeader++;return {count:1};}},
    projectMembership:{
      async updateMany({where}) {shadow = shadow.map(item=>where.userId.notIn.includes(item.userId) ? item : {...item,status:'inactive'});},
      async upsert({create,update,where}) {if(where.projectId_userId.userId===failOnUser) throw new Error('crew disk interrupted');
        const at = shadow.findIndex(item=>item.userId===create.userId);
        if(at===-1) shadow.push(create); else shadow[at]={...shadow[at],...update};
      },
    },
  };
  const result = await callback(tx);
  original = shadow; header = shadowHeader;
  return result;
};
const patch = (tx) => tx.project.updateMany({where:{id:'p1',revision:7}}).then(async ({count})=>{
  if (!count) throw new Error('CAS conflict');
  await writeProjectMembershipsInTransaction(tx,{projectId:'p1',memberIds:['old','new'],leadId:'old',roleLabels:{old:'lead',new:'reviewer'}});
});
await assert.rejects(transact(patch,'new'),/crew disk interrupted/);
check(header===7 && original.length===1 && original[0].status==='active', 'failed membership write rolls back header and crew in same transaction');
await transact(patch);
check(header===8 && original.some(row=>row.userId==='new'&&row.accessLevel==='view'), 'successful atomic crew change persists with header revision');
await assert.rejects(transact(patch),/CAS conflict/);
check(header===8, 'stale revision is rejected without any new writes');
await assert.rejects(transact(async tx=>writeProjectMembershipsInTransaction(tx,{projectId:'p1',memberIds:['old','new'],leadId:'old',roleLabels:{new:'unknown-privileged-role'}})),/Unknown Project role/);
check(header===8 && original.length===2, 'invalid role prevents partial crew persistence');
const panel = readFileSync('packages/renderer/src/features/projects/ProjectAccessPanel.tsx','utf8');
const pickerHook = readFileSync('packages/renderer/src/components/useAuthorizedProjectResources.ts','utf8');
check(panel.includes('pickerNextCursor') && panel.includes('loadMorePickerTargets') && pickerHook.includes('sequence !== requestSequence.current'), 'picker exposes continuation through shared hook with stale-response protection');
check(pickerHook.includes('setResources([])') && pickerHook.includes('setNextCursor(null)'), 'picker hook clears old discovery projection and cursor');
const access = readFileSync('apps/server/src/domains/access/access-routes.ts','utf8');
check(access.includes('actorId: actor.id') && access.includes('cursorSecret: deps.cursorSecret') && access.includes('INVALID_PICKER_CURSOR'), 'route binds encrypted cursor to authenticated actor and handles rejected cursors');
console.log(`${passed}/${passed} atomic project and secure cursor assertions passed`);
