// RC19: real repository hosting policy assertions plus concurrency/secret
// lifecycle source contracts. Fast enough to run for every source installer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateRepositoryHosting} from '../../apps/server/src/domains/source-control/repository-hosting-policy.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript');}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript`);}})();
let assertions=0;
function check(f){f(); assertions++;}
const cases=[
  [{hostingMode:'cluster'},null],
  [{hostingMode:'cluster',connectionId:'provider'},'Cluster-hosted'],
  [{hostingMode:'cluster',remoteUrl:'https://git.example/org/repo'},'Cluster-hosted'],
  [{hostingMode:'cluster',cloneUrl:'https://git.example/org/repo'},'Cluster-hosted'],
  [{hostingMode:'remote'},'active Source Control provider'],
  [{hostingMode:'remote',connectionId:'provider'},'remote Git URL'],
  [{hostingMode:'remote',connectionId:'provider',remoteUrl:'https://git.example/org/repo.git'},null],
  [{hostingMode:'remote',connectionId:'provider',cloneUrl:'ssh://git@git.example/org/repo.git'},null],
  [{hostingMode:'remote',connectionId:'provider',providerRepositoryId:'org/repo'},null],
  [{hostingMode:'remote',connectionId:'provider',remoteUrl:'file:///etc/passwd'},'HTTPS, HTTP, or SSH'],
  [{hostingMode:'remote',connectionId:'provider',remoteUrl:'https://alice:password@git.example/repo'},'cannot contain credentials'],
  [{hostingMode:'remote',connectionId:'provider',remoteUrl:'https://git.example/repo?token=abc'},'cannot contain credentials'],
  [{hostingMode:'remote',connectionId:'provider',remoteUrl:'https://git.example/repo#branch'},'cannot contain credentials'],
];
for (const [input,expected] of cases) check(()=>{
  const actual=validateRepositoryHosting(input);
  assert.equal(expected===null,actual===null,`hosting input ${JSON.stringify(input)}: ${actual}`);
  if(expected!==null)assert.ok(actual?.includes(expected));
});
const server=read('apps/server/src/domains/integrations/integration-routes.ts');
const inventory=read('packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx');
const vault=read('packages/renderer/src/features/inventory/VaultManager.tsx');
const repo=read('packages/renderer/src/features/admin/ProductionIntegrationAdminPages.tsx');
const css=read('packages/renderer/src/features/inventory/inventory-workspace.css');
for(const file of ['apps/server/src/domains/source-control/repository-hosting-policy.ts','apps/server/src/domains/integrations/integration-routes.ts','packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx','packages/renderer/src/features/inventory/VaultManager.tsx','packages/renderer/src/features/admin/ProductionIntegrationAdminPages.tsx']){
  check(()=>{
    const parsed=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(parsed.parseDiagnostics.length,0,parsed.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('\n'));
  });
}
for(const [source,pattern,explanation] of [
  [server,/const hostingError = validateRepositoryHosting\(body\)/,'enforce on API'],
  [repo,/hostingMode: repositoryConnectionId \? "remote" : "cluster"/,'explicit modes'],
  [repo,/if \(!id\) setRemoteUrl\(""\)/,'clear stale remote'],
  [repo,/"source_commit", "integration_connection"\], debounceMs: 750/,'no generic job refresh'],
  [inventory,/allocationsLoadedFor === selected\.id && !allocationsLoading/,'capacity owner'],
  [inventory,/!allocationsReady \|\| !assignment\.userId/,'assignment admission'],
  [inventory,/sequence !== allocationSequence\.current \|\| selectedAssetRef\.current !== id/,'stale allocations'],
  [inventory,/seq !== poolKeysSeq\.current \|\| chosenPoolRef\.current !== id/,'stale key pages'],
  [inventory,/document\.visibilityState === "hidden"/,'hide plaintext on blur'],
  [inventory,/poolSequence !== poolKeysSeq\.current/,'late key reveal'],
  [vault,/revealSequence !== revealRequestId\.current \|\| selectedSecretRef\.current !== item\.id/,'late vault reveal'],
  [inventory,/poolCreatorOpen && <div className="cluster-key-pool-creator"/,'on-demand creator'],
  [css,/\.cluster-key-pool-key-grid/,'key metadata cards'],
  [repo,/queryApi<RepositoryStateDetail>\(/,'on-demand repository history'],
  [repo,/repositoryDetail\?\.repositoryId === selectedRepository\.id/,'repository detail owner'],
  [repo,/repositoryDetail\.data\.commits\.slice\(0, 8\)/,'bounded commit history'],
])check(()=>assert.match(source,pattern,explanation));
check(()=>{ const identity = JSON.parse(read('config/release-candidate.json')); assert.ok(identity.sequence >= 19); assert.equal(identity.release, `1.0.0-rc.${identity.sequence}`); });
console.log(`RC19 repository-hosting / allocation / privileged-reveal / layout checks: ${assertions} passed`);
