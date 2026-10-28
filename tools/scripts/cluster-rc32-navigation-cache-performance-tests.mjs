import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const ts = (() => { try {return require('typescript');} catch {return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');} })();
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
let passed = 0;
const check = (value,message) => {assert.ok(value,message); passed++};
const scope = {current:'account-A'};
let generation=0;
let reads=0,writes=0,network=0;
let apiResolve = null;
let holdApi=false;
let online=true;
const cache = new Map();
const background=new Map();
const date = Date;
class ApiError extends Error { constructor(message,status){super(message);this.status=status;this.retryAfterSeconds=null;} }
const modules = {
 '../offline-storage': {getOfflineScope:()=>scope.current,readCachedResponse:async()=>{reads++;throw new Error('IndexedDB blocked');},writeCachedResponse:async()=>{writes++;}},
 '../performance':{recordPerformanceMetric:()=>{}},
 './transport': {api:async path => {network++;if(holdApi)await new Promise(resolve=>{apiResolve=resolve}); return {path,network};}},
 './errors':{ApiError,isApiNetworkFailure:()=>false,isOnline:()=>online},
 './cache':{queryCache:cache,backgroundRevalidations:background,currentSessionCacheGeneration:()=>generation,setQueryCache:(key,value)=>{cache.set(key,value);}},
 './live-search-authorization': {requiresFreshSearchAuthorization: path=>path.startsWith('/api/command/search')},
};
const querySource=read('packages/renderer/src/core/api/query.ts');
const compiled=ts.transpileModule(querySource,{fileName:'query.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
check(!compiled.diagnostics?.length,'TypeScript transpilation succeeds');
const mod={exports:{}};
const fakeDocument={visibilityState:'visible'};
vm.runInNewContext(compiled.outputText,{exports:mod.exports,module:mod,require: specifier => { if(!(specifier in modules))throw new Error(specifier);return modules[specifier]},Date:date,document:fakeDocument,Map,Math,Promise,Error,Number,String,Set,console},{filename:'query.cjs'});
const {peekApiQuery,queryApi}=mod.exports;
check(typeof peekApiQuery==='function','Synchronous snapshot access exported');
check((await queryApi('/api/projects')).network===1,'Network read succeeds when IndexedDB unavailable');
check(reads===1,'Cold reads attempt durable storage once');
check(peekApiQuery('/api/projects').network===1,'Instant fresh snapshot reused');
check((await queryApi('/api/projects')).network===1 && network===1,'Fresh read avoids network entirely');
cache.set('account-A:/api/outdated',{value:{previous:true},staleAt:Date.now()-1,expiresAt:Date.now()+50000,tags:[]});
check(peekApiQuery('/api/outdated')===null,'Stale snapshot cannot bypass freshness boundary');
await queryApi('/api/outdated');
await queryApi('/api/outdated');
await Promise.all([...background.values()]);
check(network===2,'Stale reads trigger only one background revalidation');
cache.set('account-A:/api/outdated',{value:{previous:true},staleAt:Date.now()-1,expiresAt:Date.now()+50000,tags:[]});
await queryApi('/api/outdated');await Promise.all([...background.values()]);
check(network===2,'Remount storm does not start repeated background GETs');
fakeDocument.visibilityState='hidden';
cache.set('account-A:/api/hidden',{value:{previous:true},staleAt:Date.now()-1,expiresAt:Date.now()+50000,tags:[]});
await queryApi('/api/hidden');await Promise.all([...background.values()]);
check(network===2,'Hidden tab does not revalidate stale data');
fakeDocument.visibilityState='visible';
let beforeReads=reads;
await queryApi('/api/projects',{force:true});
check(network===3 && reads===beforeReads,'Forced refresh skips IndexedDB and goes straight to network');
check(peekApiQuery('/api/command/search?q=private')===null,'Command search never returns a cached snapshot');
cache.set('account-A:/api/command/search?q=private',{value:{secret:'x'},staleAt:Date.now()+90000,expiresAt:Date.now()+90000});
check(peekApiQuery('/api/command/search?q=private')===null,'Search is excluded even if old data remains cached');
await queryApi('/api/command/search?q=private');
check(network===4,'Sensitive search goes to server for authorization');
scope.current='account-B';
check(peekApiQuery('/api/projects')===null,'Cached projections never cross authenticated account scope');
const once=read('packages/renderer/src/features/timeline/TimelineWorkspacePage.tsx');
check(once.includes('peekApiQuery<TimelinePayload>'),'Timeline hydrates its first frame from fresh memory');
check(once.includes('setPayload(snapshot); // never display a different range'),'Timeline does not display another filter range as a cached match');
check(once.includes('staleMs: 60_000, maxAgeMs: 5 * 60_000'),'Timeline has bounded one-minute network freshness');
const schema=read('apps/server/prisma/schema.prisma');
const card=schema.match(/model Card \{[\s\S]*?^\}/m)?.[0]||'';
check(card.includes('@@index([archived, dueDate])'),'Card model indexes Timeline due-date scan');
check(read('apps/server/prisma/migrations/20261111000000_rc32_timeline_due_date_lookup/migration.sql').includes('"Card_archived_dueDate_idx"'),'Migration creates index for archived due-date range');
const refresh=read('packages/renderer/src/core/visible-refresh.ts');
check(refresh.includes('const recoveryGapMs = Math.max(12_000, minimumGapMs)'), 'Rapid focus/visibility changes use a recovery cooldown');
check(refresh.includes('const onFocus = () => { requestRecovery(); schedule(); }'), 'Focus recovery no longer causes unconditional refresh storms');
check(refresh.includes('const onOnline = () => { request(); schedule(); }'), 'Connectivity restoration still gets immediate recovery');
check(read('apps/server/src/core/storage-migrations.ts').includes('"Card_archived_dueDate_idx"'), 'Server checks new performance index before admitting writes');
const app=read('packages/renderer/src/features/application/ClusterApplication.tsx');
check(app.includes('async function loadProjects(force = false)'), 'Project navigation defaults to cached reads');
check(app.includes('async function loadWhiteboards(force = false)'), 'Whiteboard navigation defaults to cached reads');
check(app.includes('async function loadBoard(id = boardId, force = false)'), 'Board reopening defaults to cached reads');
check(app.includes('void loadProjects(true)'), 'Project data revalidates on relevant realtime changes');
check(app.includes('loadWhiteboards(true)') && app.includes('loadBoard(boardId, true)'), 'Realtime and reconnect refreshes remain authoritative');
check(app.includes('}, 500);'), 'Rapid realtime deltas coalesce before network refresh');
const release=JSON.parse(read('config/release-candidate.json'));
check(release.sequence>=32 && release.release===`1.0.0-rc.${release.sequence}`,'Current release identity is valid and includes RC32 fixes');
for (const file of ['packages/renderer/src/core/api/query.ts','packages/renderer/src/core/api/index.ts','packages/renderer/src/features/timeline/TimelineWorkspacePage.tsx']) {
 const ast=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 check(!ast.parseDiagnostics.length,`No syntax errors in ${file}`);
}
console.log(`RC32: ${passed}/${passed} navigation/cache/backend focused assertions passed`);
