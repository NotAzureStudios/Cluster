import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run the real TypeScript publication helper without installing the entire server dependency tree.
const temp = mkdtempSync(join(tmpdir(), 'cluster-0538-publication-'));
let publish;
try {
  const root = new URL('../../apps/server/src/domains/studio-systems/', import.meta.url);
  const runtime = readFileSync(new URL('studio-onboarding-runtime.ts', root), 'utf8');
  const helper = readFileSync(new URL('studio-onboarding-publication.ts', root), 'utf8').replace('./studio-onboarding-runtime.js', './studio-onboarding-runtime.ts');
  writeFileSync(join(temp, 'package.json'), '{"type":"module"}');
  writeFileSync(join(temp, 'studio-onboarding-runtime.ts'), runtime);
  writeFileSync(join(temp, 'studio-onboarding-publication.ts'), helper);
  publish = (await import(pathToFileURL(join(temp,'studio-onboarding-publication.ts')).href)).commitStudioOnboardingPublication;
} finally { rmSync(temp, {recursive:true,force:true}); }

const input = ({ publish: isPublished = true, supersede = true } = {}) => ({
  planId: 'p1',
  body: { versionLabel:'2.0', publish:isPublished, supersedePreviousAssignments:supersede, dueAfterDays:3, reminderDaysBefore:1, escalationDaysAfter:1 },
  resolved: [{position:0,kind:'packet',resourceId:'pk1',resourceLabel:'Welcome',resourceVersionLabel:'1.0',required:true}],
  userIds:['u1','u2'], publishedAt:isPublished ? new Date('2026-10-10T16:00:00.000Z') : null,
});
function store({ failAt } = {}) {
  const state = {
    versions: [{id:'old',planId:'p1',version:1}],
    assignments: [{id:'old-u1',planVersionId:'old',userId:'u1',status:'active'}],
    planStatus: 'draft',
  };
  let lockSeen = false;
  const prisma = {
    async $transaction(fn) {
      const next=structuredClone(state);
      const tx={
        $queryRaw: async (...parts)=>{ lockSeen=true; return [{id:'p1'}]; },
        studioOnboardingPlanVersion: {
          findFirst: async () => { assert.ok(lockSeen, 'version must be created only after plan lock');return [...next.versions].sort((a,b)=>b.version-a.version)[0]; },
          create: async ({data})=>{const version={id:'new',...data};next.versions.push(version);return version;},
          findMany: async ({where})=>next.versions.filter(v=>v.id!==where.id.not).map(v=>({id:v.id})),
        },
        studioOnboardingAssignment: {
          createMany: async ({data})=>{
            if(failAt==='assign') throw new Error('simulated assignment failure');
            next.assignments.push(...data);
            return {count:data.length};
          },
          updateMany: async ({where,data})=>{
            if(failAt==='supersede') throw new Error('simulated supersession failure');
            let count=0;
            for(const a of next.assignments){if(where.planVersionId.in.includes(a.planVersionId) && where.userId.in.includes(a.userId) && a.status==='active'){Object.assign(a,data);count++;}}
            return {count};
          },
        },
        studioOnboardingPlan: {update: async ({data})=>{if(failAt==='activate') throw new Error('simulated status failure');next.planStatus=data.status;}},
      };
      const result=await fn(tx);
      Object.assign(state,next); // model transaction commit; failures discard the snapshot
      return result;
    },
  };
  return {state,prisma};
}
let cases=0;
async function test(name,run){await run();cases++;console.log('PASS',name);}
await test('Publish locks Plan and commits version + audience + supersession together', async()=>{
  const {state,prisma}=store();
  const result=await publish(prisma,input());
  assert.equal(result.assigned,2);
  assert.equal(result.superseded,1);
  assert.equal(result.created.version,2);
  assert.equal(state.versions.length,2);
  assert.equal(state.assignments.filter(a=>a.planVersionId==='new').length,2);
  assert.equal(state.assignments[0].status,'superseded');
  assert.equal(state.planStatus,'active');
});
for(const failAt of ['assign','supersede','activate']){
  await test(`Failure in ${failAt} rolls back version and all assignments`,async()=>{
    const {state,prisma}=store({failAt});
    const before=structuredClone(state);
    await assert.rejects(()=>publish(prisma,input()),/simulated/);
    assert.deepEqual(state,before);
  });
}
await test('Draft creation does not assign or activate a Plan',async()=>{
  const {state,prisma}=store();const result=await publish(prisma,input({publish:false}));
  assert.equal(result.assigned,0); assert.equal(result.superseded,0);
  assert.equal(state.versions[1].status,'draft');assert.equal(state.assignments.length,1);assert.equal(state.planStatus,'draft');
});
await test('Publishing without supersede leaves older assignments active',async()=>{
  const {state,prisma}=store();const result=await publish(prisma,input({supersede:false}));
  assert.equal(result.assigned,2);assert.equal(result.superseded,0);assert.equal(state.assignments[0].status,'active');
});
console.log(`Cluster v0.538 onboarding runtime transaction simulation: ${cases}/${cases} passed`);
