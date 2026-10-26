import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
function load(filename,stubs){const output=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};vm.runInNewContext(output,{module:mod,exports:mod.exports,require:id=>{if(!(id in stubs))throw Error(`Unexpected ${id}`);return stubs[id]},Promise,Map,Set,WeakMap,Date,String,Number,Array,Error,Boolean,console,performance});return mod.exports;}
const audience={
  loadStudioAudienceUserContext:async (_db,u,opts)=>{assert.equal(opts.strict,true);return {userId:u.id}},
  studioAudienceMatchesContext:(raw,userId)=>raw?.mode==='all'||(raw?.mode==='include'&&raw.targets.includes(userId)),
};
const sensitive=load('apps/server/src/domains/search/search-sensitive-access.ts',{'../access/studio-audience.js':audience});
const selected=[];
const state={admin:false,allowLibrary:true,toolEnabled:true,records:new Set(),recordError:false,aclError:false,failAudience:false};
const db={
  personnelRecordAttachment:{findMany:async({where})=>{if(state.recordError)throw Error('Records unavailable');selected.push([...where.libraryItemId.in]);return where.libraryItemId.in.filter(id=>state.records.has(id)).map(libraryItemId=>({libraryItemId}));},findFirst:async()=>null},
};
const access={
  contextForUser:async(_user,_db,opts)=>{assert.equal(opts.strict,true);if(state.aclError)throw Error('ACL unavailable');return {isAdmin:state.admin}},
  visibleFor:(ctx,item)=>ctx.isAdmin||state.allowLibrary,
};
const handlers=new Map();
const routes=load('apps/server/src/domains/search/search-routes.ts',{
  './search-schemas.js':{commandSearchQuerySchema:{parse:()=>({q:'file',scope:'all',limit:12})}},
  './search-repository.js':{createSearchRepository:()=>({})},
  './search-service.js':{createSearchService:()=>({
    invalidateChange(){},diagnostics:()=>({}),rebuild:async()=>({items:[]}),
    search:async options=>{
      const items=[
        {kind:'file',id:'A',resource:{kind:'library',id:'A'},raw:{id:'A',status:'active',parentId:'F1'}},
        {kind:'file',id:'B',resource:{kind:'library',id:'B'},raw:{id:'B',status:'active',parentId:'F1'}},
        {kind:'packet',id:'PACK',raw:{libraryFolder:{id:'folder',status:'active'},audienceJson:{mode:'include',targets:['u2']}}},
        {kind:'policy',id:'POL',raw:{audienceJson:{mode:'include',targets:['u2']}}},
        {kind:'calendar',id:'private',raw:{visibility:'private'}},
      ];
      await options.prepareBatch(items);
      return {decisions:await Promise.all(items.map(item=>options.canViewItem(item,item.kind==='file'?{id:'P1'}:null,[])))};
    },
  })},
  '../../core/http-errors.js':{createHttpError:(...args)=>Error(args.join(':'))},
  '../workforce/workforce-user-authority.js':{workforceAuthorityProjection:()=>({})},
  '../planning/calendar-access.js':{canAccessCalendarEvent:async()=>false},
  './search-sensitive-access.js':sensitive,
  // R70's live-record boundary is exercised independently with real admission tests.
  // This inherited fixture isolates the sensitive ACL projection contract.
  './search-live-admission.js':{createSearchLiveAdmission:()=>({prepareBatch:async()=>{},admit:()=>true})},
});
routes.registerSearchRoutes({
 app:{get:(url,fn)=>handlers.set(url,fn),post:()=>{}},prisma:db,
 getCurrentUser:async()=>({id:'u1'}),decorateUserForClient:async()=>({isAdmin:state.admin,workspaceRole:state.admin?'owner':'member'}),
 authorization:{authorize:async(_actor,_action,resource)=>({allowed:resource.kind==='tool'?state.toolEnabled:true})},
 libraryAccess:access,jobWorker:{register(){}},operations:{},
});
let passed=0;
async function check(label,run){try{await run();passed++;console.log('PASS',label)}catch(e){process.exitCode=1;console.error('FAIL',label,e)}}
async function get(){let headers={};const payload=await handlers.get('/api/command/search')({query:{}},{header:(k,v)=>{headers[k]=v}});assert.equal(headers['Cache-Control'],'private, no-store');return payload.decisions;}
await check('actual command endpoint batches Records checks and excludes restricted content',async()=>{assert.deepEqual(Array.from(await get()),[true,true,false,false,false]);assert.deepEqual(selected.pop(),['A','B']);});
await check('Records attachments stay hidden from admins in the real Search route',async()=>{state.admin=true;state.records.add('B');assert.deepEqual(Array.from(await get()),[true,false,false,false,false]);state.records.clear();state.admin=false;});
await check('folder access denial hides every Library hit even with valid Project access',async()=>{state.allowLibrary=false;assert.deepEqual(Array.from(await get()),[false,false,false,false,false]);state.allowLibrary=true;});
await check('Records store error rejects the entire Search route',async()=>{state.recordError=true;await assert.rejects(get(),/Records unavailable/);state.recordError=false;});
await check('Library ACL failure rejects rather than exposes content',async()=>{state.aclError=true;await assert.rejects(get(),/ACL unavailable/);state.aclError=false;});
await check('disabling the Packets tool suppresses policy and Packet search for admin',async()=>{state.admin=true;state.toolEnabled=false;assert.deepEqual(Array.from(await get()),[true,true,false,false,false]);state.toolEnabled=true;state.admin=false;});
console.log(`${passed}/6 R47 real Search route integration checks passed`);if(passed!==6)process.exitCode=1;
