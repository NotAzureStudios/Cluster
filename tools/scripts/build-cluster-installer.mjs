// Deterministically bundle only application build inputs for Cluster Installer.
// Development history is removed from this clean source tree and excluded from
// the installation payload. Uses Node core only; no ZIP/npm package needed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDesktopOnlyDistributionPath } from './cluster-distribution-scope.mjs';
import {validStableServerRelease} from './cluster-server-release-sequence.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const installer=path.join(root,'tools','installer');
const embedded=path.join(installer,'assets','bundled-source.zip');
const binary=path.join(root,'bin','Cluster-Installer.exe');
const keepRoot=new Set(['package.json','package-lock.json','.npmrc','prisma.config.ts']);
const mode=process.env.CLUSTER_INSTALLER_PAYLOAD||'prebuilt';
if(!['prebuilt','source'].includes(mode))throw new Error('CLUSTER_INSTALLER_PAYLOAD must be prebuilt or source');
const prebuilt=mode==='prebuilt';
const requiredRuntime=[
 'packages/shared/dist/index.js','apps/server/dist/index.js',
 'apps/server/dist/generated/prisma/client.js','apps/web/dist/index.html',
 'node_modules/@prisma/client/package.json','bin/ClusterServer.exe',
 'bin/Cluster Server.exe','bin/cluster-host.exe','bin/cluster-update-helper.exe',
 'bin/cluster-workstation-service.exe','tools/scripts/cluster-rc-preflight.mjs',
 'tools/scripts/cluster-rc-smoke.mjs','tools/scripts/cluster-rc-runtime-admission.mjs'
];
const excludedFolders=new Set(prebuilt?['.git','.cache','__pycache__']:['node_modules','.git','.cache','dist','build','.next','coverage','__pycache__']);
function omit(rel) {
  if(prebuilt&&isDesktopOnlyDistributionPath(rel))return true;
  const parts=rel.split('/');
  if (parts.some((v,i)=>excludedFolders.has(v) && i!==0)) return true;
  if (parts[0]==='.git'||parts[0]==='build'||(!prebuilt&&parts[0]==='node_modules'))return true;
  if(prebuilt&&(parts[0]==='docs'||rel.startsWith('tools/fixtures/')||rel.startsWith('tools/installer/')))return true;
  if(['data','runtime','backups','Revisions','Rollback','Toolchains','Build'].includes(parts[0]))return true;
  if(rel.endsWith('.pfx')||rel.endsWith('.p12')||rel.endsWith('.sqlite')||rel.endsWith('.sqlite3')||rel.endsWith('.db')||
    (parts.some(x=>x==='.env'||(x.startsWith('.env.')&&x!=='.env.example'))))return true;
  if(prebuilt&&rel.startsWith('node_modules/@cluster/'))return true;
  if (rel==='SOURCE_FILE_MANIFEST.sha256'||rel==='bin/Cluster-Installer.exe'||(!prebuilt&&rel==='bin/Cluster Server.exe')||rel==='tools/installer/assets/bundled-source.zip')return true;
  if (rel.startsWith('tools/installer/assets/'))return true;
  if (parts.length===1 && !keepRoot.has(rel))return true; // root historical development evidence, >1000 files
  if (rel.endsWith('.tsbuildinfo')||rel.endsWith('.pyc'))return true;
  return false;
}
function collect(folder,out=[]){
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const p=path.join(folder,entry.name);const rel=path.relative(root,p).split(path.sep).join('/');
    if(entry.isSymbolicLink()){
      if(prebuilt&&rel.startsWith('node_modules/@cluster/'))continue;
      throw new Error('Unexpected symlink or junction in installer payload: '+rel);
    }
    if(entry.isDirectory()) {if(!excludedFolders.has(entry.name)&&!(prebuilt&&(rel==='docs'||isDesktopOnlyDistributionPath(rel))))collect(p,out);continue;}
    if(entry.isFile()&&!omit(rel))out.push(rel);
  }
  return out;
}
const table=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let j=0;j<8;j++)c=c&1?0xEDB88320^(c>>>1):c>>>1;table[n]=c>>>0;}
function crc32(buf){let c=0xFFFFFFFF;for(const b of buf)c=table[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function u16(v){const b=Buffer.alloc(2);b.writeUInt16LE(v);return b;}
function u32(v){const b=Buffer.alloc(4);b.writeUInt32LE(v);return b;}
function makeZip(entries){
  const locals=[],directory=[];let position=0;
  for(const {name,data} of entries){
    const filename=Buffer.from(name,'utf8');const compressed=deflateRawSync(data,{level:6});
    const crc=crc32(data);const flag=0x800;const method=8;
    const local=Buffer.concat([u32(0x04034b50),u16(20),u16(flag),u16(method),u16(0),u16(33),u32(crc),u32(compressed.length),u32(data.length),u16(filename.length),u16(0),filename,compressed]);
    const central=Buffer.concat([u32(0x02014b50),u16(20),u16(20),u16(flag),u16(method),u16(0),u16(33),u32(crc),u32(compressed.length),u32(data.length),u16(filename.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(position),filename]);
    position+=local.length;locals.push(local);directory.push(central);
  }
  if(entries.length>65535)throw new Error('Too many entries');
  const center=Buffer.concat(directory);
  const end=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(center.length),u32(position),u16(0)]);
  return Buffer.concat([...locals,center,end]);
}
function run(){
  let prebuiltMetadata=null;
  if(prebuilt){
    if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Prebuilt Windows installer requires a Windows x64 build runner');
    const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
    const lockFile=path.join(root,'package-lock.json');
    if(!fs.existsSync(lockFile))throw new Error('Prebuilt installer BLOCKED: package-lock.json is missing');
    const lock=JSON.parse(fs.readFileSync(lockFile,'utf8'));
    if(lock.lockfileVersion<3||lock.name!==pkg.name||lock.version!==pkg.version||lock.packages?.['']?.version!==pkg.version)
      throw new Error('Prebuilt installer BLOCKED: package-lock.json does not match root package');
    const release=JSON.parse(fs.readFileSync(path.join(root,'config/release-candidate.json'),'utf8'));
    const stableRelease=validStableServerRelease(release);
    const legacyRC=release.channel==='rc'&&/^1\.0\.0-rc\.[1-9][0-9]*$/.test(release.release)&&
      release.sequence===Number(release.release.split('.').at(-1));
    if(release.sourceVersion!==pkg.version||!(stableRelease||legacyRC))
      throw new Error('Prebuilt installer BLOCKED: release metadata mismatch');
    const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
    if(commit.status!==0||!/^[a-f0-9]{40}$/.test(commit.stdout.trim()))throw new Error('Prebuilt installer requires a traceable commit');
    const hashes={};
    for(const rel of requiredRuntime){
      const file=path.join(root,...rel.split('/'));
      if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size===0)
        throw new Error('Prebuilt installer missing compiled runtime artifact: '+rel);
      const data=fs.readFileSync(file);
      if(rel.toLowerCase().endsWith('.exe')&&data.subarray(0,2).toString('ascii')!=='MZ')
        throw new Error('Invalid Windows PE binary: '+rel);
      hashes[rel]=createHash('sha256').update(data).digest('hex');
    }
    if(!fs.existsSync(path.join(root,'apps/web/dist/assets'))||
       !fs.readdirSync(path.join(root,'apps/web/dist/assets')).some(name=>name.endsWith('.js')))
      throw new Error('Prebuilt installer missing compiled web assets');
    const gitStatus=spawnSync('git',['diff','--quiet'],{cwd:root});
    const stagedStatus=spawnSync('git',['diff','--cached','--quiet'],{cwd:root});
    if(gitStatus.status!==0||stagedStatus.status!==0)throw new Error('Prebuilt release must be produced from clean tracked source');
    prebuiltMetadata={
      schema:1,product:'cluster-server',kind:'prebuilt-windows-x64',
      release:release.release,sequence:release.sequence,sourceVersion:release.sourceVersion,
      commit:commit.stdout.trim(),requiredArtifacts:hashes
    };
  }
  const files=collect(root).sort();const manifest=[];const entries=[];
  let totalBytes=0;
  for(const rel of files){
    const data=fs.readFileSync(path.join(root,...rel.split('/')));
    totalBytes+=data.length;
    if(data.length>268435456||totalBytes>2147483648)throw new Error('Installer payload exceeds ZIP safety budget: '+rel);
    manifest.push(createHash('sha256').update(data).digest('hex')+'  '+rel);
    entries.push({name:'source/'+rel,data});
  }
  if(prebuilt){
    const rel='config/prebuilt-runtime.json';
    if(files.includes(rel))throw new Error('Generated runtime metadata must not exist in source tree');
    const data=Buffer.from(JSON.stringify(prebuiltMetadata,null,2)+'\n');
    manifest.push(createHash('sha256').update(data).digest('hex')+'  '+rel);
    entries.push({name:'source/'+rel,data});
  }
  entries.push({name:'source/SOURCE_FILE_MANIFEST.sha256',data:Buffer.from(manifest.join('\n')+'\n')});
  entries.sort((a,b)=>a.name.localeCompare(b.name,'en'));
  fs.mkdirSync(path.dirname(embedded),{recursive:true});
  const zipped=makeZip(entries);
  fs.writeFileSync(embedded,zipped,{flag:'w',mode:0o600});
  const sha=createHash('sha256').update(zipped).digest('hex');
  const go=process.env.GO_EXE||'go';
  let goCheck=spawnSync(go,['test','./...'],{cwd:installer,encoding:'utf8',env:{...process.env,GOTOOLCHAIN:'local'},timeout:120000});
  if(goCheck.status!==0)throw new Error(`Cluster Installer tests failed: ${goCheck.stdout}\n${goCheck.stderr}`);
  fs.mkdirSync(path.dirname(binary),{recursive:true});
  const env={...process.env,GOOS:'windows',GOARCH:'amd64',CGO_ENABLED:'0',GOTOOLCHAIN:'local'};
  const build=spawnSync(go,['build','-trimpath','-ldflags=-s -w','-o',binary,'.'],{cwd:installer,env,encoding:'utf8',timeout:180000});
  if(build.status!==0)throw new Error(`Cluster Installer build failed: ${build.stdout}\n${build.stderr}`);
  const header=fs.readFileSync(binary).subarray(0,2).toString('ascii');if(header!=='MZ')throw new Error('Expected PE Windows executable');
  console.log(JSON.stringify({installer:binary,mode,sourceFiles:files.length,payloadBytes:zipped.length,sha256:sha,executableBytes:fs.statSync(binary).size,goTests:'passed',certified:false},null,2));
}
try{run();}finally {try{fs.rmSync(embedded,{force:true});}catch{}}
