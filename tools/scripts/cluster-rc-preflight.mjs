// Release-candidate gate: check the independently built artifact, not syntax alone.
// Run from the extracted full source before applying a candidate to the server.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const metadata=JSON.parse(fs.readFileSync(path.join(root,'config/release-candidate.json'),'utf8'));
const built=process.argv.includes('--built');
// A prebuilt Windows payload embeds Install-Cluster.ps1 in the outer EXE, not
// inside the deployed runtime ZIP. A full developer source checkout still
// requires the installer source. Never waive this from --built alone.
const prebuiltMetadataFile=path.join(root,'config/prebuilt-runtime.json');
let prebuiltMetadata=null;
if(built&&fs.existsSync(prebuiltMetadataFile)){
 try{prebuiltMetadata=JSON.parse(fs.readFileSync(prebuiltMetadataFile,'utf8'));}
 catch{prebuiltMetadata={};} // A malformed descriptor must fail identity admission below.
}
const validPrebuilt=Boolean(prebuiltMetadata&&prebuiltMetadata.schema===1&&
 prebuiltMetadata.product==='cluster-server'&&prebuiltMetadata.kind==='prebuilt-windows-x64'&&
 prebuiltMetadata.release===metadata.release&&prebuiltMetadata.sequence===metadata.sequence&&
 prebuiltMetadata.sourceVersion===metadata.sourceVersion&&
 /^[a-f0-9]{40}$/.test(prebuiltMetadata.commit||''));
const requiredSources=['package.json','config/toolchain-versions.json','apps/server/prisma/schema.prisma','tools/scripts/database-command.mjs','apps/server-launcher-go/main.go','tools/server-entry-go/main.go','tools/scripts/build-cluster-server-entry.mjs'];
if(!validPrebuilt)requiredSources.push('tools/installer/Install-Cluster.ps1');
const requiredArtifacts=['packages/shared/dist/index.js','apps/server/dist/index.js','apps/web/dist/index.html','apps/web/dist/assets','apps/server/src/generated/prisma','apps/server/dist/generated/prisma/client.js','node_modules/@prisma/client/package.json','bin/ClusterServer.exe','bin/Cluster Server.exe','bin/cluster-host.exe','bin/cluster-update-helper.exe','bin/cluster-workstation-service.exe'];
const failures=[],evidence={release:metadata.release,channel:metadata.channel,sourceVersion:metadata.sourceVersion,checks:{},artifacts:{},warnings:[]};
const check=(name,ok)=>{evidence.checks[name]=ok;if(!ok)failures.push(name);};
check('Release metadata',metadata.schema===1&&Number.isInteger(metadata.sequence)&&metadata.sequence>=1&&((metadata.channel==='stable'&&/^1\.0\.[1-9][0-9]*$/.test(metadata.release))||(metadata.channel==='rc'&&/^1\.0\.0-rc\.[1-9][0-9]*$/.test(metadata.release)))&&((metadata.channel==='stable'&&metadata.release===metadata.sourceVersion)||metadata.channel==='rc'));
const toolchain=JSON.parse(fs.readFileSync(path.join(root,'config/toolchain-versions.json'),'utf8'));
check('Toolchain version agreement',toolchain.cluster===metadata.sourceVersion);
if(prebuiltMetadata)check('Prebuilt runtime identity',validPrebuilt);
for(const item of requiredSources)check('Source: '+item,fs.existsSync(path.join(root,item)));
if(!fs.existsSync(path.join(root,'package-lock.json')))evidence.warnings.push('Missing npm lockfile: full reproducibility certification BLOCKED.');
if(built){
 for(const item of requiredArtifacts){const full=path.join(root,item);const present=fs.existsSync(full);check('Built: '+item,present);if(present&&fs.statSync(full).isFile()){evidence.artifacts[item]=createHash('sha256').update(fs.readFileSync(full)).digest('hex');}}
 const webAssets=path.join(root,'apps/web/dist/assets');
 if(fs.existsSync(webAssets))check('Nonempty web assets',fs.readdirSync(webAssets).length>0);
 // Native Windows binaries must actually be Windows executables, not placeholders.
 for(const file of ['bin/ClusterServer.exe','bin/Cluster Server.exe','bin/cluster-host.exe','bin/cluster-update-helper.exe','bin/cluster-workstation-service.exe']) {
  const full=path.join(root,file);if(fs.existsSync(full))check('PE format: '+file,fs.readFileSync(full).subarray(0,2).toString('ascii')==='MZ');
 }
}
evidence.pass=failures.length===0;
evidence.certified=false;
console.log(JSON.stringify(evidence,null,2));
if(failures.length){console.error('Cluster RC candidate gate FAILED:',failures.join(', '));process.exitCode=1;}
