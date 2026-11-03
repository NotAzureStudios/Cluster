// Regression for the first published 1.0 installer. The prebuilt payload
// intentionally has no tools/installer directory; source-only smoke tests
// also depend on paths excluded by the production packager.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const preflightSource=fs.readFileSync(path.join(sourceRoot,'tools/scripts/cluster-rc-preflight.mjs'),'utf8');
const installerSource=fs.readFileSync(path.join(sourceRoot,'tools/installer/Install-Cluster.ps1'),'utf8');
const packagerSource=fs.readFileSync(path.join(sourceRoot,'tools/scripts/build-cluster-installer.mjs'),'utf8');
const smokeSource=fs.readFileSync(path.join(sourceRoot,'tools/scripts/cluster-rc-smoke.mjs'),'utf8');

assert.match(packagerSource, /prebuilt&&\(parts\[0\]==='docs'\|\|rel\.startsWith\('tools\/fixtures\/'\)\|\|rel\.startsWith\('tools\/installer\/'\)\)/);
assert.match(smokeSource, /tools\/installer\/installer-contract-tests\.mjs/);
assert.match(installerSource, /if \(\$isPrebuilt\) \{[\s\S]*?Run 'node' @\('tools\/scripts\/cluster-rc-runtime-admission\.mjs'\) \$source[\s\S]*?\} else \{\s*Run 'node' @\('tools\/scripts\/cluster-rc-smoke\.mjs'\) \$source\s*\}/);
assert.match(installerSource,/RepairWorkspaceJunctions \$target\s*Run 'node' @\('tools\/scripts\/cluster-rc-runtime-admission\.mjs'\) \$target/);
assert.match(preflightSource,/if\(!validPrebuilt\)requiredSources\.push\('tools\/installer\/Install-Cluster\.ps1'\)/);

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-prebuilt-install-gate-'));
let tests=0;
function put(p,data='fixture'){const full=path.join(temp,p);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,data);}
function run(args=[]){
 const r=spawnSync(process.execPath,[path.join(temp,'tools/scripts/cluster-rc-preflight.mjs'),...args],{cwd:temp,encoding:'utf8',timeout:15000});
 assert.equal(r.error,undefined,String(r.error));
 return r;
}
try{
 put('tools/scripts/cluster-rc-preflight.mjs',preflightSource);
 const release=JSON.parse(fs.readFileSync(path.join(sourceRoot,'config/release-candidate.json'),'utf8'));
 const toolchain=JSON.parse(fs.readFileSync(path.join(sourceRoot,'config/toolchain-versions.json'),'utf8'));
 put('config/release-candidate.json',JSON.stringify(release));
 put('config/toolchain-versions.json',JSON.stringify(toolchain));
 for(const s of [
  'package.json','apps/server/prisma/schema.prisma','tools/scripts/database-command.mjs',
  'apps/server-launcher-go/main.go','tools/server-entry-go/main.go','tools/scripts/build-cluster-server-entry.mjs',
  'packages/shared/dist/index.js','apps/server/dist/index.js','apps/web/dist/index.html',
  'apps/server/dist/generated/prisma/client.js','node_modules/@prisma/client/package.json'
 ])put(s);
 put('package-lock.json','{"lockfileVersion":3}');
 fs.mkdirSync(path.join(temp,'apps/server/src/generated/prisma'),{recursive:true});
 put('apps/web/dist/assets/index.js','test');
 for(const s of [
  'bin/ClusterServer.exe','bin/Cluster Server.exe','bin/cluster-host.exe',
  'bin/cluster-update-helper.exe','bin/cluster-workstation-service.exe'
 ])put(s,'MZ'+String.fromCharCode(0).repeat(1024));
 const sourceWithoutBootstrap=run();
 assert.notEqual(sourceWithoutBootstrap.status,0,'Source checkout must still require installer bootstrap script');
 assert.match(sourceWithoutBootstrap.stderr,/Source: tools\/installer\/Install-Cluster\.ps1/);tests++;
 const sourceBuiltWithoutBootstrap=run(['--built']);
 assert.notEqual(sourceBuiltWithoutBootstrap.status,0,'--built must not alone bypass missing source bootstrap');tests++;
 const descriptor={schema:1,product:'cluster-server',kind:'prebuilt-windows-x64',release:release.release,
  sequence:release.sequence,sourceVersion:release.sourceVersion,commit:'a'.repeat(40)};
 put('config/prebuilt-runtime.json',JSON.stringify(descriptor));
 const prebuilt=run(['--built']);
 assert.equal(prebuilt.status,0,prebuilt.stderr);
 assert.equal(JSON.parse(prebuilt.stdout).checks['Prebuilt runtime identity'],true);tests++;
 const wrongDescriptor={...descriptor,release:'1.0.0-rc.999'};
 put('config/prebuilt-runtime.json',JSON.stringify(wrongDescriptor));
 const tampered=run(['--built']);
 assert.notEqual(tampered.status,0,'Unmatched prebuilt metadata must not bypass source admission');
 assert.match(tampered.stderr,/Prebuilt runtime identity/);tests++;
 fs.rmSync(path.join(temp,'config/prebuilt-runtime.json'));
 put('tools/installer/Install-Cluster.ps1','# developer bootstrap');
 const developer=run(['--built']);
 assert.equal(developer.status,0,developer.stderr);tests++;
 console.log(`${tests}/${tests} installer source/prebuilt admission integration cases passed`);
} finally {fs.rmSync(temp,{recursive:true,force:true});}
