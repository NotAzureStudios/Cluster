// Cluster suite source version contract. Desktop native parity is a separate
// package version; a published release tag/binary is a separate operation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const app=read('package.json');
const lock=read('package-lock.json');
const metadata=read('config/release-candidate.json');
const toolchain=read('config/toolchain-versions.json');
const distribution=read('config/distribution-profiles.json');
const version=app.version;
assert.equal(version,'1.0.1','Expected 1.0.1 maintenance source');
assert.match(version,/^1\.0\.[1-9][0-9]*$/);
assert.equal(metadata.release,version);
assert.equal(metadata.sourceVersion,version);
assert.equal(metadata.channel,'stable');
assert.ok(Number.isInteger(metadata.sequence)&&metadata.sequence>=51);
assert.equal(toolchain.cluster,version);
assert.equal(distribution.sourceVersion,version);
assert.equal(lock.version,version);
assert.equal(lock.packages[''].version,version);
assert.equal(lock.name,app.name);
const workspaces=app.workspaces;
assert.equal(workspaces.length,6,'Expected six npm workspaces');
for(const workspace of workspaces){
 const source=read(workspace+'/package.json');
 const pinned=lock.packages[workspace];
 assert.equal(source.version,version,workspace+' source version');
 assert.equal(pinned?.version,version,workspace+' lockfile version');
 assert.equal(pinned?.name,source.name,workspace+' identity');
}
assert.equal(distribution.profiles['desktop-windows-x64'].desktopNativeVersion,toolchain.desktop.parityVersionHold,
 'Native Qt Desktop parity version remains independently pinned');
const bootstrap=fs.readFileSync(path.join(root,'tools/installer/Install-Cluster.ps1'),'utf8');
assert.match(bootstrap,/\$releaseIdentity\.channel -notin @\('rc','stable'\)/,
 'PowerShell must admit stable release identity');
assert.match(bootstrap,/releaseChannel = \[string\]\$releaseIdentity\.channel/);
const go=fs.readFileSync(path.join(root,'tools/installer/main.go'),'utf8');
assert.match(go,/release\.Channel != "stable"/,'Go bootstrap must recognize stable release');
const builder=fs.readFileSync(path.join(root,'tools/scripts/build-cluster-installer.mjs'),'utf8');
assert.match(builder,/const stableRelease=/,'Prebuilt packager must admit stable 1.0.x identities');
const preflight=fs.readFileSync(path.join(root,'tools/scripts/cluster-rc-preflight.mjs'),'utf8');
assert.match(preflight,/metadata\.channel==='stable'/,'Preflight must recognize stable release');
console.log('Cluster '+version+' source and six locked workspaces are aligned; Qt Desktop retains independent version '+toolchain.desktop.parityVersionHold);
