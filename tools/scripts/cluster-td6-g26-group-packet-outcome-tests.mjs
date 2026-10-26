#!/usr/bin/env node
/** G26 grouped author reporting, recipient discovery and privacy regressions. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
let count=0;
async function check(label,fn){await fn();count++;console.log(`PASS grouped G26 ${label}`);}
function type(shape={}){return {min(){return this},max(){return this},trim(){return this},regex(){return this},int(){return this},datetime(){return this},nullable(){return this},optional(){return this},strict(){return this},default(){return this},parse(input){return {...{limit:50,status:'all',query:''},...input}},safeParse(input){return {success:true,data:input}}};}
const z={object:()=>type(),string:()=>type(),enum:()=>type(),coerce:{number:()=>type()},array:()=>type(),literal:()=>type()};
function load(file,mocks={}){const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require(name){if(Object.hasOwn(mocks,name))return mocks[name];return require(name)},Buffer,Date,Map,Set,JSON,Number,Error,console},{filename:file});return module.exports;}
const route=load('apps/server/src/domains/library/packet-routes.ts',{
 zod:{z},
 './packet-publication.js':{publishedPacketAudience:()=>({mode:'all',targets:[]})},
 './packet-bundle.js':{},'./packet-pdf-derivative.js':{},'./packet-file-text-derivative.js':{},
 './packet-file-image-derivative.js':{},'./packet-file-pdf-derivative.js':{},'./packet-file-audio-derivative.js':{},
 '@cluster/shared':{studioAudienceSchema:{parse:x=>x}},
 '../access/studio-audience.js':{loadStudioAudienceUserContext:async(_db,user,opts)=>{assert.equal(opts.strict,true);return {id:user.id}},studioAudienceMatchesContext:(_audience,id)=>id!=='hidden'},
 '../studio-systems/studio-knowledge-runtime.js':{},
 '../studio-systems/studio-knowledge-evidence.js':{},
});
const manifest='a'.repeat(64),now=new Date(),ago=n=>new Date(now.getTime()-n*86400000),later=n=>new Date(now.getTime()+n*86400000);
const requirements=[
 {id:'a',recipientId:'ack',assignedAt:ago(1),dueAt:ago(1),manifestSha256:manifest,acknowledgedAt:ago(0.5)},
 {id:'b',recipientId:'late',assignedAt:ago(2),dueAt:ago(1),manifestSha256:manifest,acknowledgedAt:null},
 {id:'c',recipientId:'soon',assignedAt:ago(3),dueAt:later(2),manifestSha256:manifest,acknowledgedAt:null},
 {id:'d',recipientId:'future',assignedAt:ago(4),dueAt:later(10),manifestSha256:manifest,acknowledgedAt:null},
 {id:'e',recipientId:'none',assignedAt:ago(5),dueAt:null,manifestSha256:manifest,acknowledgedAt:null},
 {id:'f',recipientId:'bad',assignedAt:ago(6),dueAt:null,manifestSha256:'b'.repeat(64),acknowledgedAt:ago(1)},
 {id:'g',recipientId:'ack2',assignedAt:ago(7),dueAt:null,manifestSha256:manifest,acknowledgedAt:ago(1)},
];
const people=['ack','late','soon','future','none','bad','ack2','hidden',...Array.from({length:512},(_,i)=>'extra-'+String(i).padStart(3,'0'))]
 .map((id,i)=>({id,username:id,displayName:id}));
function fixture({admin=true,editable=true,visible=true,summaryOverride=null}={}){
 const handlers=new Map(),calls=[],db={};
 const settings={packetsEnabled:true},release={id:'rel',packetDefinitionId:'def',versionLabel:'4.2',manifestSha256:manifest,revokedAt:null};
 const candidates=people.filter(p=>p.id!=='hidden');
 db.libraryItem={findFirst:async()=>({id:'packet',packetDefinition:{id:'def'}})};
 db.packetRelease={findFirst:async({where})=>where.id==='rel'?release:null};
 db.packetReleaseRequirement={findFirst:async({where})=>requirements.find(r=>r.id===where.id&&where.releaseId==='rel')||null,
   findMany:async({take=51})=>requirements.slice(0,take),count:async()=>requirements.length};
 db.packetReleaseAcknowledgment={findMany:async()=>requirements.filter(r=>r.acknowledgedAt).map(r=>({recipientId:r.recipientId,manifestSha256:r.manifestSha256,acknowledgedAt:r.acknowledgedAt}))};
 db.packetReleaseReminderDelivery={groupBy:async()=>[]};
 db.user={findMany:async({where,take,skip=0,cursor})=>{
   const found=where?.id?.in?people.filter(p=>where.id.in.includes(p.id)):people.filter(p=>!where?.AND||p.username.includes(where.AND[0].OR[0].username.contains));
   const offset=cursor?found.findIndex(p=>p.id===cursor.id)+skip:0;
   return found.slice(offset,offset+(take||1000));
 },findFirst:async({where})=>people.find(p=>p.id===where.id)||null};
 db.$queryRaw=async(strings,...values)=>{
   const sql=strings.join('?');calls.push({sql,values});
   if(sql.includes('COUNT(*) AS "total"'))return [summaryOverride || {total:7n,integrityIssues:1n,acknowledged:2n,awaiting:4n,overdue:1n,dueSoon:1n,noDeadline:1n}];
   if(sql.includes('WITH matching AS (')){
     const status=values.find(v=>typeof v==='string'&&['overdue','awaiting','acknowledged','due_soon','no_deadline','integrity_issue'].includes(v));
     const filtered=requirements.filter(r=>({overdue:!r.acknowledgedAt&&r.dueAt&&r.dueAt<now,awaiting:!r.acknowledgedAt&&r.manifestSha256===manifest,acknowledged:!!r.acknowledgedAt&&r.manifestSha256===manifest,due_soon:!r.acknowledgedAt&&r.dueAt&&r.dueAt>=now&&r.dueAt<later(7),no_deadline:!r.acknowledgedAt&&r.dueAt===null,integrity_issue:r.manifestSha256!==manifest})[status]);
     return filtered.map(r=>({...r,lastRemindedAt:null}));
   }
   throw Error('unexpected SQL '+sql.slice(0,80));
 };
 route.registerPacketRoutes({app:{get:(path,fn)=>handlers.set('GET '+path,fn),post:()=>{},patch:()=>{}},prisma:db,
   accessContext:async()=>({user:{id:'manager'},decorated:{isAdmin:admin}}),readSettings:async()=>settings,
   hasToolPermission:()=>editable,visibleFor:()=>visible,ensurePacketsRoot:async()=>({id:'root'}),itemInclude:{},serializeLibraryItem:x=>x});
 async function get(path,query={}){const fn=handlers.get('GET /api/packets/:packetId/releases/:releaseId/'+path);assert.ok(fn,path);
   const reply={status:200,value:null,headers:{},code(n){this.status=n;return this},send(v){this.value=v;return this},header(k,v){this.headers[k]=v;return this}};
   const returned=await fn({params:{packetId:'packet',releaseId:'rel'},query},reply);
   return {status:reply.status,result:reply.value??returned,headers:reply.headers}; }
 return {get,calls,db};
}
await check('source declares bounded DB-wide aggregation with exact manifest join',()=>{
 const sql=readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8');
 assert.match(sql,/COUNT\(\*\) FILTER \(WHERE r\."manifestSha256" <>/);
 assert.match(sql,/a\."manifestSha256" = r\."manifestSha256"/);
 assert.match(sql,/COUNT\(\*\) FILTER \(WHERE r\."manifestSha256" = .* AND a\."id" IS NULL/);
 assert.match(sql,/WHERE r\."releaseId" = \$\{releaseId\}/);
});
await check('complete-release report returns global counts despite paginated rows',async()=>{
 const f=fixture(),r=await f.get('requirements/summary');assert.equal(r.status,200);assert.equal(r.result.summary.total,7);
 assert.equal(r.result.summary.acknowledged,2);assert.equal(r.result.summary.awaiting,4);
 assert.equal(r.result.summary.overdue,1);assert.equal(r.result.summary.integrityIssues,1);
 assert.equal(r.headers['Cache-Control'],'private, no-store');
});
await check('overdue filter only returns overdue requirements and no source payload',async()=>{
 const f=fixture(),r=await f.get('requirements',{status:'overdue',limit:50});assert.equal(r.status,200);
 assert.deepEqual(Array.from(r.result.requirements.map(x=>x.recipientId)),['late']);assert.ok(!JSON.stringify(r.result).includes('sourceItems'));
 assert.ok(f.calls.some(x=>x.sql.includes('WITH matching AS (')));
});
await check('no-deadline, upcoming, acknowledgment and integrity filters',async()=>{
 for(const [status,id] of [['no_deadline','none'],['due_soon','soon'],['integrity_issue','bad']]){
 const r=await fixture().get('requirements',{status,limit:50});assert.deepEqual(Array.from(r.result.requirements.map(x=>x.recipientId)),[id]);
 }
 const a=await fixture().get('requirements',{status:'acknowledged'});assert.equal(a.result.requirements.length,2);
});
await check('manifest anomaly never appears acknowledged even with a bogus acceptance row',async()=>{
 const r=await fixture().get('requirements',{status:'integrity_issue'});assert.equal(r.result.requirements[0].integrityIssue,true);
 assert.equal(r.result.requirements[0].acknowledgedAt,null);
});
await check('summary fails closed for inconsistent or unsafe aggregate counts',async()=>{
 for(const summaryOverride of [{total:8n,integrityIssues:1n,acknowledged:2n,awaiting:4n,overdue:1n,dueSoon:1n,noDeadline:1n},
 {total:9007199254740993n,integrityIssues:1n,acknowledged:2n,awaiting:4n,overdue:1n,dueSoon:1n,noDeadline:1n}])
 await assert.rejects(fixture({summaryOverride}).get('requirements/summary'),/PACKET_REQUIREMENT_/);
});
await check('private author-only endpoints reject noneditors and hidden packet',async()=>{
 for(const opts of [{admin:false,editable:false},{visible:false}]){
  const f=fixture(opts);for(const ep of ['requirements/summary','requirements']){
    const result=await f.get(ep,{status:'overdue'});assert.ok(result.status>=400);assert.equal(f.calls.length,0);
  }
 }
});
await check('bad and cross-release cursors fail before any filtered SQL',async()=>{
 const f=fixture(),result=await f.get('requirements',{status:'awaiting',cursor:'other-release',limit:50});
 assert.equal(result.status,400);assert.equal(result.result.code,'PACKET_REQUIREMENT_CURSOR_INVALID');assert.equal(f.calls.length,0);
});
await check('stale reporting clock gets rejected rather than misclassifying deadlines',async()=>{
 const f=fixture(),result=await f.get('requirements',{status:'overdue',asOf:'2024-02-02T00:00:00.000Z'});
 assert.equal(result.status,400);assert.equal(result.result.code,'PACKET_REQUIREMENT_CLOCK_INVALID');assert.equal(f.calls.length,0);
});
await check('recipient discovery has stable bounded pages beyond 500 users',async()=>{
 const f=fixture(),r=await f.get('requirement-candidates',{limit:75});assert.equal(r.status,200);
 assert.equal(r.result.inspectedCount,75);assert.ok(r.result.nextCursor);
 assert.ok(r.result.candidates.every(p=>p.id!=='hidden'));
 const n=await f.get('requirement-candidates',{limit:75,cursor:r.result.nextCursor});
 assert.equal(n.status,200);assert.ok(n.result.candidates[0].id!==r.result.candidates[0].id);
});
await check('recipient search does not disclose nonaudience users and invalid cursor fails closed',async()=>{
 const f=fixture();const r=await f.get('requirement-candidates',{query:'hidden',limit:50});
 assert.equal(r.status,200);assert.equal(r.result.candidates.length,0);
 const invalid=await f.get('requirement-candidates',{query:'extra-001',cursor:'not-a-real-account'});
 assert.equal(invalid.status,400);assert.equal(invalid.result.code,'PACKET_CANDIDATE_CURSOR_INVALID');
});
await check('pagination limits are applied before expensive strict-audience checks',()=>{
 const src=readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8');
 assert.match(src,/const page = rows\.slice\(0, limit\);\s+const eligible = \[\];\s+for \(const candidate of page\)/);
 assert.match(src,/orderBy: \[\{ username: "asc" \}, \{ id: "asc" \}\]/);
 assert.match(src,/take: limit \+ 1/);
});
await check('author UI includes global truth, filters, remnant pagination, search and no automatic reminders',()=>{
 const src=readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx','utf8');
 for(const needle of ['requirementSummary','dueSoon','integrityIssues','Filter required acknowledgments','loadReleaseRequirements(requirementReleaseId, requirementReport.nextCursor!, requirementStatus)','searchRequirementCandidates','Load more eligible recipients','candidateLoadedQuery','Manifest integrity exception'])assert.ok(src.includes(needle),needle);
 assert.match(src,/sendRequiredPacketReminder\(row\.id\)/);
});
console.log(`Grouped G26 Packet outcome/recipient tests: ${count}/${count} passed`);
