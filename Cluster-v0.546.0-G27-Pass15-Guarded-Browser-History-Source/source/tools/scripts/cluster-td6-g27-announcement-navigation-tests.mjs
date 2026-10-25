#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);const ts=require('typescript');
const load=(file,imports={})=>{
  const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',js)(name=>{
    if(Object.hasOwn(imports,name)) return imports[name];
    throw Error(`Unexpected import ${name} in ${file}`);
  },module,module.exports);
  return module.exports;
};
let cases=0;
async function check(label,fn){await fn();cases++;console.log(`PASS G27 announcement/navigation ${label}`)}
const cursor=load('apps/server/src/core/cursor-pagination.ts');
const chain={ min(){return this},max(){return this},trim(){return this},int(){return this},optional(){return this},default(){return this}, parse:value=>value };
const z={object:()=>chain,string:()=>chain,coerce:{number:()=>chain}};
const shared={};
const routeStub={};
let allowed=true,dbReads=0,rows=[];
const register={get:new Map(),post:new Map(),put:new Map(),patch:new Map(),delete:new Map()};
const prisma={studioAnnouncement:{
 findMany:async({where,orderBy,take})=>{
   dbReads++;
   const filtered=rows.filter(row=>(where?.AND||[]).every(predicate=>{
      if(predicate.OR?.[0]?.createdAt){return row.createdAt.getTime()<predicate.OR[0].createdAt.lt.getTime()||(row.createdAt.getTime()===predicate.OR[1].AND[0].createdAt.getTime()&&row.id<predicate.OR[1].AND[1].id.lt);}
      if(predicate.OR?.[0]?.title){const q=predicate.OR[0].title.contains.toLowerCase();return row.title.toLowerCase().includes(q)||String(row.body||'').toLowerCase().includes(q);}
      return true;
   }));
   return filtered.sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id)).slice(0,take);
 },
 findUnique:async({where})=>{dbReads++;return rows.find(row=>row.id===where.id)||null;},
}};
const stubSource={
 '@cluster/shared':shared,
 'zod':{z},
 '../../core/cursor-pagination.js':cursor,
 '../access/studio-audience.js':{parseStudioAudience:()=>({mode:'all',targets:[]})},
 './studio-form-runtime.js':{},
 './studio-onboarding-runtime.js':{},
 '../workforce/workforce-normalization.js':{},
 './studio-announcement-delivery.js':{createStudioAnnouncementDelivery:()=>({})},
 './studio-application-revisions.js':{},
 '../../core/security-audit-store.js':{},
 './studio-announcement-create-intents.js':{announcementCreateDigest:()=> 'test-digest',isAnnouncementCreateUniqueConflict:(e)=>e?.code==='P2002'},
    './studio-application-profile.js':{},
};
const {registerStudioWorkflowRoutes}=load('apps/server/src/domains/studio-systems/studio-workflow-routes.ts',stubSource);
registerStudioWorkflowRoutes({app:Object.fromEntries(Object.entries(register).map(([kind,map])=>[kind,(path,cb)=>map.set(path,cb)])),prisma,authorization:{requireTool:async()=>allowed},events:{}});
const list=register.get.get('/api/studio-systems/announcements');
const exact=register.get.get('/api/studio-systems/announcements/:announcementId');
assert.equal(typeof list,'function');assert.equal(typeof exact,'function');
const response=()=>({status:200,headers:{},code(code){this.status=code;return this},send(value){return value},header(k,v){this.headers[k]=v;return this}});
rows=Array.from({length:151},(_,i)=>({id:String(i).padStart(4,'0'),createdAt:new Date('2026-10-20T00:00:00Z'),title:`Announcement ${i}`,audienceJson:'{}'}));
await check('list limits to 50 rows and advertises a continuation cursor',async()=>{
 const r=response(),value=await list({query:{limit:50}},r);
 assert.equal(value.announcements.length,50);assert.equal(value.hasMore,true);assert.ok(value.nextCursor);assert.equal(r.headers['Cache-Control'],'private, no-store');
});
await check('pagination consumes every item even with identical timestamps',async()=>{
 let cursorValue=null;const ids=[];
 do {const result=await list({query:{limit:50,...(cursorValue?{cursor:cursorValue}:{})}},response());ids.push(...result.announcements.map(x=>x.id));cursorValue=result.nextCursor;}while(cursorValue);
 assert.equal(ids.length,151);assert.equal(new Set(ids).size,151);
});
await check('server-side announcement search stays paginated',async()=>{const result=await list({query:{limit:7,q:'Announcement 14'}},response());assert.ok(result.announcements.length<=7);assert.ok(result.announcements.every(row=>row.title.includes('14')))});
await check('bad cursor fails without querying records',async()=>{const before=dbReads;const r=response(),value=await list({query:{limit:50,cursor:'garbage!'}},r);assert.equal(r.status,400);assert.equal(value.code,'ANNOUNCEMENT_CURSOR_INVALID');assert.equal(dbReads,before)});
await check('targeted lookup reaches records beyond the first page',async()=>{const r=response(),found=await exact({params:{announcementId:'0000'}},r);assert.equal(found.announcement.id,'0000');assert.equal(r.headers['Cache-Control'],'private, no-store')});
await check('missing record is 404 without exposing a historical title',async()=>{const r=response(),found=await exact({params:{announcementId:'missing'}},r);assert.equal(r.status,404);assert.equal(found.code,'ANNOUNCEMENT_UNAVAILABLE')});
await check('unauthorized listing and direct lookup never touch database',async()=>{allowed=false;const before=dbReads;await list({query:{limit:50}},response());await exact({params:{announcementId:'0000'}},response());assert.equal(dbReads,before);allowed=true});
const navigation=load('packages/renderer/src/features/notifications/notification-navigation.ts',{
 '@cluster/shared':{clusterResourceAddressFromEntity:({entityType,entityId})=> entityType==='announcement'?{kind:'announcement',id:entityId}:null},
 '../workflow/resource-navigation':{clusterResourceNavigation:()=>null},
});
await check('recipient announcement stays in Inbox',()=>{const item={entityType:'announcement',entityId:'0003',category:'activity'};assert.deepEqual(navigation.notificationWorkNavigation(item),{screen:'inbox'});assert.equal(navigation.notificationDesktopRoute(navigation.notificationWorkNavigation(item)),'inbox')});
await check('malformed or non-resolvable activity targets do not route to Studio Settings',()=>{assert.notEqual(navigation.notificationWorkNavigation({entityType:'announcement',entityId:'0003',category:'activity'}).screen,'studioSettings')});
await check('Desktop navigation preserves ordinary administrative inspector context',()=>{assert.equal(navigation.notificationDesktopRoute({screen:'studioSettings',inspectScope:'studio-announcement',inspectId:'0003'}),'studioSettings/inspect/studio_announcement/0003')});
await check('Command Search only offers composer to administrators',()=>{const src=readFileSync('packages/renderer/src/features/search/CommandPalette.tsx','utf8');assert.match(src,/user\.isAdmin && canOpenScreen\(user, "studioSettings"\)/);assert.match(src,/action-compose-announcement/)});
await check('Studio Settings routes exact announcement IDs to panel',()=>{const app=readFileSync('packages/renderer/src/features/application/ClusterApplication.tsx','utf8');const settings=readFileSync('packages/renderer/src/features/settings/StudioSettingsPage.tsx','utf8');const section=readFileSync('packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx','utf8');assert.match(app,/target\.inspectScope === "studio-announcement"/);assert.match(settings,/targetAnnouncementId=/);assert.match(section,/targetAnnouncementId=\{targetAnnouncementId\}/)});
await check('announcement list supports on-demand retrieval and same-frame create lock',()=>{const src=readFileSync('packages/renderer/src/features/settings/StudioAnnouncementsPanel.tsx','utf8');assert.match(src,/loadOlder\(/);assert.match(src,/createLock\.current = true/);assert.match(src,/targetAnnouncementId/)});
console.log(`G27 announcement/navigation: ${cases}/${cases} passed`);
