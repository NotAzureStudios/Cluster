import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=(file)=>readFileSync(new URL(`../../${file}`,import.meta.url),'utf8');
let owner={scope:'alice',generation:1};
const events=[], timers=[];
class CustomEvent {constructor(type,init={}){this.type=type;this.detail=init.detail}}
const win={ dispatchEvent:e=>events.push(e), setTimeout:fn=>{timers.push(fn);return timers.length} };
const load=(file,deps={})=>{
 const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:mod.exports,module:mod,require:(id)=>deps[id]??{},window:win,CustomEvent,
  Date,Math,String,Set,Map,Promise,
 });return mod.exports;
};
const ownership={sameUserStateOwner:(a,b)=>a.scope!=='anonymous'&&a.scope===b.scope&&a.generation===b.generation};
const binding=load('packages/renderer/src/core/session-bound-handoff.ts',{'./offline-storage':{getOfflineScopeIdentity:()=>({...owner})},'./user-state-ownership':ownership});
const create=load('packages/renderer/src/features/create/shared-create-handoff.ts',{'../../core/session-bound-handoff':binding,'@cluster/shared':{SHARED_CREATE_COMPLETED_EVENT:'done'}});
const navCalls=[];
const tickets=load('packages/renderer/src/features/tickets/ticket-navigation.ts',{'../../core/session-bound-handoff':binding,'../workflow/work-navigation':{openClusterWorkNavigation:target=>navCalls.push(target)}});
const search=load('packages/renderer/src/features/search/command-palette-handoff.ts',{'../../core/session-bound-handoff':binding});
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS',name)};
const source={projectId:'private',boardId:'b'};
create.openSharedCreate('card',{source,title:'Private card'});
check('create handoff delivered during same session',()=>assert.equal(create.readSharedCreateHandoff()?.source.projectId,'private'));
create.openSharedCreate('ticket',{title:'Sensitive'});
owner={scope:'bob',generation:2};
check('different account cannot consume Create handoff',()=>assert.equal(create.readSharedCreateHandoff(),null));
owner={scope:'alice',generation:3};
check('consumed foreign Create handoff does not reappear on return',()=>assert.equal(create.readSharedCreateHandoff(),null));
create.openSharedCreate('card',{title:'Old session'});
owner={scope:'bob',generation:4};owner={scope:'alice',generation:5};
check('A-to-B-to-A cannot revive old Create context',()=>assert.equal(create.readSharedCreateHandoff(),null));
tickets.openTicketWorkspace({projectId:'private',assigneeId:'alice',query:'priority'});
check('Ticket navigation retains correct parent',()=>assert.equal(navCalls.at(-1).projectId,'private'));
check('Ticket handoff delivered in original session',()=>assert.equal(tickets.readPendingTicketWorkspaceContext()?.assigneeId,'alice'));
tickets.openTicketWorkspace({projectId:'confidential'});
owner={scope:'bob',generation:6};
check('Ticket context not delivered into different account',()=>assert.equal(tickets.readPendingTicketWorkspaceContext(),null));
const priorEvents=events.length;
for(const fire of timers.splice(0))fire();
check('delayed Ticket event does not cross account boundary',()=>assert.equal(events.length,priorEvents));
search.openCommandPaletteWithQuery('secret file');
check('Search query delivered within session',()=>assert.equal(search.readPendingCommandPaletteQuery(),'secret file'));
search.openCommandPaletteWithQuery('private person');
owner={scope:'alice',generation:7};
check('Search query dropped on account switch',()=>assert.equal(search.readPendingCommandPaletteQuery(),null));
owner={scope:'anonymous',generation:8};
create.openSharedCreate('project',{title:'No account'});
check('public shell never retains authenticated Create context',()=>assert.equal(create.readSharedCreateHandoff(),null));
check('public shell session handoff is not bound',()=>assert.equal(binding.bindSessionHandoff({x:1}),null));
owner={scope:'alice',generation:9};
const old=binding.bindSessionHandoff('one');
owner={scope:'alice',generation:10};
check('new generation invalidates same account handoff',()=>assert.equal(binding.unwrapSessionHandoff(old),null));
check('source guards all three in-app handoff paths',()=>{
  for(const file of ['features/create/shared-create-handoff.ts','features/search/command-palette-handoff.ts','features/tickets/ticket-navigation.ts']){
    assert.match(read('packages/renderer/src/'+file),/unwrapSessionHandoff/);
  }
});
console.log(`G27 P43 session handoffs: ${checks}/${checks} checks passed`);
