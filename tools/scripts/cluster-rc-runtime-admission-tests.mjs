import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
let checks=0;const check=(desc,yes)=>{assert.ok(yes,desc);checks++;console.log('PASS',desc);};
const installer=fs.readFileSync(path.join(root,'tools/installer/Install-Cluster.ps1'),'utf8');
const ui=fs.readFileSync(path.join(root,'apps/server-launcher-go/launcher_ui_windows.go'),'utf8');
const services=fs.readFileSync(path.join(root,'apps/server-launcher-go/service_actions_windows.go'),'utf8');
const release=JSON.parse(fs.readFileSync(path.join(root,'config/release-candidate.json'),'utf8'));
check('candidate version and sequence are consistent',release.release===`1.0.0-rc.${release.sequence}`&&release.sequence>=6);
check('workspace junctions repaired before applied marker',installer.includes('RepairWorkspaceJunctions $target')&&installer.indexOf('RepairWorkspaceJunctions $target')<installer.indexOf('$record = @{ schema=3'));
check('deployment admission inside rollback fence',installer.indexOf("Run 'node' @('tools/scripts/cluster-rc-runtime-admission.mjs') $target")<installer.indexOf('$committed = $true'));
check('never recursively removes workspace junction',installer.includes('[IO.Directory]::Delete($link, $false)')&&!installer.includes('Remove-Item -LiteralPath $link -Recurse'));
check('all six npm workspaces repaired',installer.includes('integrations/discord-bot')&&installer.includes('packages/shared'));
const launch=ui.slice(ui.indexOf("func runPlatformLauncher(options launcherOptions) error {"), ui.indexOf("func runWindowsControlPanel("));
check('ordinary Win32 UI no forced UAC',!launch.includes('ensureWindowsAdministrator'));
check('service management still elevates',services.includes('ensureWindowsAdministrator()'));
check('native interface shows RC display name',ui.includes('displayReleaseVersion(options.root)'));
for(const section of ['apps/server-launcher-go','apps/host-go']) {
 const code=fs.readFileSync(path.join(root,section,'release_display.go'),'utf8');
 check(section+' release label tied to managed marker',code.includes('marker.ClusterVersion != version')&&code.includes('marker.ManagedInstaller'));
}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-deploy-test-'));
try{
 const mockRoot=path.join(tmp,'installed');
 const workspaces=[['@cluster/shared','packages/shared'],['@cluster/server','apps/server'],['@cluster/web','apps/web'],['@cluster/api-client','packages/api-client'],['@cluster/renderer','packages/renderer'],['@cluster/discord-bot','integrations/discord-bot']];
 const files=['packages/shared/dist/index.js','apps/server/dist/index.js','apps/server/dist/generated/prisma/client.js','apps/web/dist/index.html','apps/web/dist/assets/app.js','bin/ClusterServer.exe','bin/cluster-host.exe','bin/cluster-update-helper.exe','bin/cluster-workstation-service.exe','node_modules/@prisma/client/package.json','node_modules/@prisma/client/index.js','node_modules/fastify/package.json','node_modules/fastify/index.js'];
 for(const [name,rel] of workspaces){const dest=path.join(mockRoot,rel);fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({name,main:'dist/index.js',exports:{'.':'./dist/index.js'},type:'module'}));}
 for(const file of files){const dest=path.join(mockRoot,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest, file.endsWith('package.json') ? JSON.stringify({name:file.includes('fastify')?'fastify':'@prisma/client',main:'index.js'}) : 'export default {}');}
 fs.writeFileSync(path.join(mockRoot,'package.json'),JSON.stringify({workspaces:workspaces.map(([,rel])=>rel)}));
 const destScript=path.join(mockRoot,'tools/scripts/cluster-rc-runtime-admission.mjs');fs.mkdirSync(path.dirname(destScript),{recursive:true});fs.copyFileSync(path.join(root,'tools/scripts/cluster-rc-runtime-admission.mjs'),destScript);
 const scope=path.join(mockRoot,'node_modules/@cluster');fs.mkdirSync(scope,{recursive:true});
 for(const [name,rel] of workspaces){fs.symlinkSync(path.join(mockRoot,rel),path.join(scope,name.split('/')[1]),'dir');}
 const run=()=>spawnSync(process.execPath,[destScript],{cwd:mockRoot,encoding:'utf8'});
 let result=run();check('admission accepts valid deployed workspace layout',result.status===0);
 const sharedLink=path.join(scope,'shared');fs.unlinkSync(sharedLink);
 fs.symlinkSync(path.join(tmp,'dead-staging','packages/shared'),sharedLink,'dir');
 result=run();check('admission blocks dangling staging junction',result.status!==0&&result.stderr.includes('DEPLOYMENT BLOCKED'));
 fs.unlinkSync(sharedLink);fs.symlinkSync(path.join(mockRoot,'packages/shared'),sharedLink,'dir');
 fs.unlinkSync(path.join(mockRoot,'packages/shared/dist/index.js'));
 result=run();check('admission blocks missing compiled shared module',result.status!==0);
 fs.writeFileSync(path.join(mockRoot,'packages/shared/dist/index.js'),'export default {}');
 fs.unlinkSync(path.join(mockRoot,'apps/server/dist/generated/prisma/client.js'));
 result=run();check('admission blocks missing generated Prisma Windows client',result.status!==0);
 fs.writeFileSync(path.join(mockRoot,'apps/server/dist/generated/prisma/client.js'),'export default {}');
 fs.unlinkSync(path.join(mockRoot,'bin/cluster-host.exe'));
 result=run();check('admission blocks missing native Host executable',result.status!==0);
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
console.log(`${checks}/${checks} RC deployment and release checks passed`);
