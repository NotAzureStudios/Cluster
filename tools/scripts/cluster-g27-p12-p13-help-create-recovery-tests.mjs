import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const load=name=>{
 const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(read(name),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports},{filename:name});
 return mod.exports;
};
const help=load('packages/renderer/src/features/help/contextual-help.ts');
const create=load('packages/renderer/src/features/create/create-intent-control.ts');
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name)}
await check('Help covers principal first-party workflows without a second wiki',async()=>{
 const screens=help.CLUSTER_HELP_TOPICS.map(topic=>topic.screen);
 assert.equal(new Set(screens).size,screens.length);
 for(const id of ['dashboard','projects','project','board','whiteboard','tickets','timeline','calendar','scheduler','library','packets','people','mywork','inbox','settings','studioSettings','serverConfig','admin','toolInfrastructure','desktop'])assert.ok(screens.includes(id),id);
 for(const topic of help.CLUSTER_HELP_TOPICS){assert.ok(topic.title.length>2);assert.ok(topic.tasks.length>=2);assert.ok(topic.recovery.length>=12);}
});
await check('Help queries are case-insensitive and require all search terms',async()=>{
 const topics=help.CLUSTER_HELP_TOPICS;
 assert.equal(help.searchHelpTopics(topics,'differentthing').length,0);
 assert.equal(help.searchHelpTopics(topics,'private participant').some(topic=>topic.screen==='calendar'),true);
 assert.equal(help.searchHelpTopics(topics,'LIBRARY').some(topic=>topic.screen==='library'),true);
});
await check('Help topic visibility respects authorized route predicate',async()=>{
 const allowed=help.visibleHelpTopics(screen=>screen!=='serverConfig'&&screen!=='admin');
 assert.equal(allowed.some(topic=>topic.screen==='serverConfig'),false);
 assert.equal(allowed.some(topic=>topic.screen==='inbox'),true);
 assert.equal(allowed.some(topic=>topic.screen==='admin'),false);
});
await check('Help has accessible modal, discoverable commands, and lazy component boundary',async()=>{
 const app=read('packages/renderer/src/features/application/ClusterApplication.tsx');
 const sidebar=read('packages/renderer/src/features/application/modules/ApplicationSidebar.tsx');
 const palette=read('packages/renderer/src/features/search/CommandPalette.tsx');
 const registry=read('packages/renderer/src/features/application/modules/application-lazy-workspaces.ts');
 const component=read('packages/renderer/src/features/help/ClusterHelpDialog.tsx');
 assert.match(registry,/LazyClusterHelpDialog = lazy\(/);
 assert.match(app,/contextualHelpOpen && <Suspense/);
 assert.match(app,/canAccess=\{\(candidate\) => canOpenScreen\(activeUser, candidate\)\}/);
 assert.match(sidebar,/aria-label="Help and common tasks"/);
 assert.match(palette,/key: "action-help", title: "Help & common tasks"/);
 assert.match(component,/aria-label="Help topics"/);
 assert.match(component,/labelledBy="cluster-help-title"/);
 assert.match(component,/onOpenShortcuts/);
 assert.doesNotMatch(component,/<a\s+href=/);
});
await check('Successful Create intent can never be replayed by double submit',async()=>{
 let value=0;const controller=create.createClusterCreateIntentControl(()=>String(++value));
 assert.equal(controller.begin(),true);assert.equal(controller.begin(),false);
 const original=controller.requestKey('POST','/api/cards','{"title":"x"}');
 controller.commit();controller.finish();
 assert.equal(controller.begin(),false);assert.equal(controller.requestKey('post','/api/cards','{"title":"x"}'),original);
 assert.equal(controller.reset(),true);assert.equal(controller.begin(),true);
 assert.notEqual(controller.requestKey('POST','/api/cards','{"title":"x"}'),original);
});
await check('Post-commit Create never auto-saves a completed draft or mislabels Close',async()=>{
 const form=read('packages/renderer/src/features/create/SharedCreateDrawer.tsx');
 assert.match(form,/if \(!open \|\| !draftReady \|\| settings\?\.userAutoSaveDrafts === false \|\| busy \|\| createIntentRef.current.committed\) return/);
 assert.match(form,/if \(createIntentRef.current.inFlight \|\| createIntentRef.current.committed\) return/);
 assert.match(form,/async function requestClose\(\) \{[\s\S]*?if \(createIntentRef.current.committed\) \{[\s\S]*?clearOfflineDraft\(draftKey\)/);
 assert.match(form,/\{createIntentRef.current.committed \? "Close" : "Cancel"\}/);
 assert.match(form,/disabled=\{busy \|\| createIntentRef.current.committed\} title="Create this item and stay in the drawer"/);
});
await check('Completed Create separates local post-commit storage failures from server mutation failures',async()=>{
 const form=read('packages/renderer/src/features/create/SharedCreateDrawer.tsx');
 assert.match(form,/Local conveniences run \*after\* the authoritative create/);
 assert.match(form,/try \{\s*createMemory\.save\(mode,/);
 assert.match(form,/try \{\s*await clearOfflineDraft\(draftKey\);\s*\} catch \{[\s\S]*?do not submit again/);
 assert.match(form,/do not submit again\."\);\s*return;/);
 assert.match(form,/if \(disposition === "another"\) \{[\s\S]*?createIntentRef\.current\.reset\(\)/);
});
console.log(`${checks}/${checks} G27 Pass 12/13/15 Help and Create recovery checks passed`);
