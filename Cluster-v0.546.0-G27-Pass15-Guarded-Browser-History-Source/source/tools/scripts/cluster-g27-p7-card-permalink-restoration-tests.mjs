import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const code='packages/renderer/src/features/workflow/card-link-hydration.ts';
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(read(code),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,URLSearchParams},{filename:code});
const {cardInspectorFromSearch, pendingCardBrowserLink}=mod.exports;
const sample={screen:'board',projectId:null,boardId:null,search:'?inspect=card%3Ac1&other=1'};
let passed=0;
const check=(label,fn)=>{fn();passed++;console.log('PASS '+label)};
check('cold-start browser URL recovers exact Card identity without a historical Board',()=>{
 const target=pendingCardBrowserLink(sample);
 assert.equal(target?.inspectScope,'card');assert.equal(target?.inspectId,'c1');assert.equal(target?.projectId,null);assert.equal(target?.boardId,null);
});
check('historical Project and Board do not alter Card identity',()=>{
 const target=pendingCardBrowserLink({...sample,projectId:'old-p',boardId:'old-b'});
 assert.equal(target?.boardId,'old-b');assert.equal(target?.inspectId,'c1');
});
check('card IDs use exact inspect scope, not generic inspector',()=>{
 for(const inspect of ['ticket:c1','my-card:c1','cardlist:c1','form-submission:c1']) assert.equal(cardInspectorFromSearch('?inspect='+encodeURIComponent(inspect)),null);
});
check('blank and missing Card identity cannot hydrate',()=>{
 assert.equal(cardInspectorFromSearch('?inspect=card%3A'),null);
 assert.equal(cardInspectorFromSearch(''),null);
});
check('URLs with additional query keys still have bounded identity',()=>{
 assert.equal(cardInspectorFromSearch('?workProject=legacy&inspect=card%3Aa.1%3A2&workPacket=xx'),'a.1:2');
});
check('malformed, oversized, escaped and pathlike Card IDs cannot hydrate',()=>{
 for(const id of ['../etc','/aaa',' a','a b','a/b','a\\b','😀','a'.repeat(201)]) assert.equal(cardInspectorFromSearch('?inspect='+encodeURIComponent('card:'+id)),null,id);
});
check('non-Board workspaces never treat matching inspector as Card authority',()=>{
 for(const screen of ['projects','project','tickets','inbox','settings','calendar']) assert.equal(pendingCardBrowserLink({...sample,screen}),null);
});
check('non-card inspector does not redirect a healthy Board',()=>{
 assert.equal(pendingCardBrowserLink({...sample,boardId:'b1',search:'?inspect=library-item%3Ac1'}),null);
});
const actions=read('packages/renderer/src/features/workflow/work-actions.ts');
const app=read('packages/renderer/src/features/application/ClusterApplication.tsx');
const desktop=read('packages/renderer/src/features/workflow/desktop-deep-link-navigation.ts');
check('Copy Link accepts Card-only targets in browser and native contexts',()=>{
 const fn=actions.slice(actions.indexOf('export async function copyWorkLink('),actions.indexOf('export async function copyWorkId('));
 assert.doesNotMatch(fn,/source\.kind === "card"/);
 assert.match(fn,/clusterWorkDeepLink\(context\)/);
 assert.match(fn,/clusterWorkPermalink\(context\.navigation\)/);
});
check('web copied permalink retains exact inspector and does not invent board ID',()=>{
 assert.match(actions,/if \(target\.inspectScope && target\.inspectId\) url\.searchParams\.set\("inspect", `\$\{target\.inspectScope\}:\$\{target\.inspectId\}`\)/);
 assert.match(actions,/if \(target\.screen === "board"\) return createNavigationState\("board", \{ projectId: target\.projectId, boardId: target\.boardId \}\)/);
});
check('startup route delays stale-Board fallback while exact Card admission proceeds',()=>{
 assert.match(app,/if \(pendingCardBrowserLink\(\{ screen, search: window\.location\.search, boardId, projectId \}\)\) return;/);
 assert.match(app,/const target = boardId \? boardOptions\(visibleProjects\)/);
});
check('browser link hydration dispatches once per identity and current account',()=>{
 assert.match(app,/const key = `\$\{activeUser\.id\}:\$\{pending\.inspectId\}`/);
 assert.match(app,/if \(hydratedCardBrowserLinkRef\.current === key\) return;/);
 assert.match(app,/openClusterWorkNavigation\(pending\)/);
});
check('Card URL restore shares fresh server-authorized resolver with Inbox/native',()=>{
 assert.match(app,/resolveAuthorizedCardNavigation\(incoming, \{/);
 assert.match(app,/`\/api\/cards\/\$\{encodeURIComponent\(id\)\}`/);
 assert.match(app,/force: true, persist: false, staleWhileRevalidate: false/);
 assert.match(desktop,/boardId: target\.boardId \|\| null/);
});
check('failed cold Card-only link recovers from empty workspace and removes inspect',()=>{
 assert.match(app,/if \(screen === "board" && !boardId\) \{[\s\S]*?url\.searchParams\.delete\("inspect"\);[\s\S]*?void setScreen\("projects"\)/);
});
check('unauthorized Boards permission cannot strand URL in blocked tool',()=>{
 assert.match(app,/if \(!canOpenScreen\(activeUser, "board"\)\) \{[\s\S]*?void setScreen\("projects"\);[\s\S]*?return;/);
});
check('historical Card movement never clears a newly selected Board before fresh read completes',()=>{
 const start=app.indexOf('void resolveAuthorizedCardNavigation(incoming');
 const end=app.indexOf('applyLinkedWork(resolved, sequence, navigationAttempt);',start);
 assert.ok(start>0 && end>start);
 assert.doesNotMatch(app.slice(start,end),/setBoardId\(/);
});
assert.equal(passed,16);
console.log(`${passed}/${passed} G27 Pass 7 Card permalink integration checks passed`);
