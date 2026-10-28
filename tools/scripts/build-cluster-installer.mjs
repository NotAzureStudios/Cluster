// Deterministically bundle only application build inputs for Cluster Installer.
// Development history is removed from this clean source tree and excluded from
// the installation payload. Uses Node core only; no ZIP/npm package needed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const installer=path.join(root,'tools','installer');
const embedded=path.join(installer,'assets','bundled-source.zip');
const binary=path.join(root,'bin','Cluster-Installer.exe');
const keepRoot=new Set(['package.json','package-lock.json','.npmrc','prisma.config.ts']);
const excludedFolders=new Set(['node_modules','.git','.cache','dist','build','.next','coverage','__pycache__']);
function omit(rel) {
  const parts=rel.split('/');
  if (parts.some((v,i)=>excludedFolders.has(v) && i!==0)) return true;
  if (parts[0]==='node_modules'||parts[0]==='.git')return true;
  if (rel==='SOURCE_FILE_MANIFEST.sha256'||rel==='bin/Cluster-Installer.exe'||rel==='bin/Cluster Server.exe'||rel==='tools/installer/assets/bundled-source.zip')return true;
  if (rel.startsWith('tools/installer/assets/'))return true;
  if (parts.length===1 && !keepRoot.has(rel))return true; // root historical development evidence, >1000 files
  if (rel.endsWith('.tsbuildinfo')||rel.endsWith('.pyc'))return true;
  return false;
}
function collect(folder,out=[]){
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const p=path.join(folder,entry.name);const rel=path.relative(root,p).split(path.sep).join('/');
    if(entry.isSymbolicLink())throw new Error('Symlinks cannot be included in Cluster Installer: '+rel);
    if(entry.isDirectory()) {if(!excludedFolders.has(entry.name))collect(p,out);continue;}
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
  const files=collect(root).sort();const manifest=[];const entries=[];
  for(const rel of files){
    const data=fs.readFileSync(path.join(root,...rel.split('/')));
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
  console.log(JSON.stringify({installer:binary,sourceFiles:files.length,payloadBytes:zipped.length,sha256:sha,executableBytes:fs.statSync(binary).size,goTests:'passed'},null,2));
}
try{run();}finally {try{fs.rmSync(embedded,{force:true});}catch{}}
